#!/usr/bin/env python3
"""Hourly verified database archives and incremental copies of immutable images."""
import argparse
import datetime
import fcntl
import json
import os
from pathlib import Path
import shutil
import sqlite3
import tarfile
import tempfile


def backup(source, destination, keep=168):
    os.umask(0o077)
    destination.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (destination / ".backup.lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with tempfile.TemporaryDirectory(dir=destination, prefix=".snapshot-") as temporary:
            temporary = Path(temporary)
            snapshot = temporary / "flashcards.sqlite"
            with sqlite3.connect((source / "flashcards.sqlite").resolve().as_uri() + "?mode=ro", uri=True) as live:
                with sqlite3.connect(snapshot) as saved:
                    live.backup(saved)
                    if saved.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                        raise RuntimeError("Database backup failed integrity validation")
                    counts = {table: saved.execute("SELECT COUNT(*) FROM " + table).fetchone()[0]
                              for table in ["users", "cards", "study_events", "user_settings"]}
            # Images have generated immutable names; copy each image once, independently of the live file.
            images = source / "card-images"
            image_pool = destination / "card-images"
            if images.exists():
                for image in images.rglob("*"):
                    if not image.is_file() or image.is_symlink() or image.name.startswith("."):
                        continue
                    target = image_pool / image.relative_to(images)
                    if target.exists():
                        continue
                    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                    staged = target.with_suffix(target.suffix + ".tmp")
                    shutil.copyfile(image, staged)
                    staged.replace(target)
            manifest = {"createdAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                        "counts": counts, "images": "Restore card-images from the sibling backup image pool"}
            (temporary / "manifest.json").write_text(json.dumps(manifest))
            stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
            archive = destination / ("flashcards-" + stamp + ".tar.gz")
            partial = archive.with_suffix(".partial")
            try:
                with tarfile.open(partial, "w:gz") as output:
                    output.add(snapshot, arcname="data/flashcards.sqlite")
                    output.add(temporary / "manifest.json", arcname="manifest.json")
                    history = source / "tomato-history"
                    if history.exists():
                        output.add(history, arcname="data/tomato-history", filter=lambda entry: None if entry.issym() or entry.islnk() else entry)
                partial.replace(archive)
            finally:
                partial.unlink(missing_ok=True)
            for old in sorted(destination.glob("flashcards-*.tar.gz"), reverse=True)[keep:]:
                old.unlink()
            print(json.dumps({"archive": str(archive), "integrity": "ok", "counts": counts}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--destination", type=Path, required=True)
    parser.add_argument("--keep", type=int, default=168)
    args = parser.parse_args()
    if args.keep < 1:
        parser.error("--keep must be at least 1")
    backup(args.source, args.destination, args.keep)
