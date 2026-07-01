#!/usr/bin/env bash
set -euo pipefail

PIPER_DIR="${PIPER_DIR:-runtime/piper}"
PIPER_VERSION="${PIPER_VERSION:-v1.2.0}"
PIPER_ARCHIVE_URL="${PIPER_ARCHIVE_URL:-https://github.com/rhasspy/piper/releases/download/$PIPER_VERSION/piper_amd64.tar.gz}"
VOICE_DIR="$PIPER_DIR/voices"
VOICE_NAME="${PIPER_VOICE_NAME:-en_GB-cori-medium}"
VOICE_MODEL="$VOICE_DIR/$VOICE_NAME.onnx"
VOICE_CONFIG="$VOICE_MODEL.json"
VOICE_BASE_URL="${PIPER_VOICE_BASE_URL:-https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_GB/cori/medium}"

mkdir -p "$PIPER_DIR" "$VOICE_DIR"

download_file() {
  local url="$1"
  local output="$2"
  curl -L --fail --show-error --progress-bar --connect-timeout 20 --speed-time 60 --speed-limit 1024 "$url" -o "$output"
}

if [[ ! -x "$PIPER_DIR/piper/piper" ]]; then
  tmp_archive="$(mktemp)"
  download_file "$PIPER_ARCHIVE_URL" "$tmp_archive"
  tar -xzf "$tmp_archive" -C "$PIPER_DIR"
  rm -f "$tmp_archive"
  chmod +x "$PIPER_DIR/piper/piper"
fi

if [[ ! -f "$VOICE_MODEL" ]]; then
  download_file "$VOICE_BASE_URL/$VOICE_NAME.onnx" "$VOICE_MODEL"
fi

if [[ ! -f "$VOICE_CONFIG" ]]; then
  download_file "$VOICE_BASE_URL/$VOICE_NAME.onnx.json" "$VOICE_CONFIG"
fi

"$PIPER_DIR/piper/piper" --help >/dev/null
printf 'piper_ready=%s voice=%s\n' "$PIPER_DIR/piper/piper" "$VOICE_MODEL"
