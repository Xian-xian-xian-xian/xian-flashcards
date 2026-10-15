#!/usr/bin/env bash
set -euo pipefail

rollback_dir=$(mktemp -d /tmp/beyour-security.XXXXXX)
site=/etc/nginx/sites-available/beyour
zone=/etc/nginx/conf.d/beyour-security.conf
headers=/etc/nginx/snippets/beyour-security-headers.conf
sudo cp "$site" "$rollback_dir/site"
for item in "$zone" "$headers"; do
  if sudo test -f "$item"; then sudo cp "$item" "$rollback_dir/$(basename "$item")"; fi
done

rollback() {
  sudo cp "$rollback_dir/site" "$site"
  for item in "$zone" "$headers"; do
    if sudo test -f "$rollback_dir/$(basename "$item")"; then
      sudo cp "$rollback_dir/$(basename "$item")" "$item"
    else
      sudo rm -f "$item"
    fi
  done
  sudo nginx -t && sudo systemctl reload nginx
}
trap rollback ERR

sudo install -m 644 deploy/beyour-security.conf "$zone"
sudo install -m 644 deploy/beyour-security-headers.conf "$headers"
sudo python3 - <<'PY'
from pathlib import Path
import re
p = Path('/etc/nginx/sites-available/beyour')
s = p.read_text()
snippet = 'include /etc/nginx/snippets/beyour-security-headers.conf;'
if snippet not in s:
    s, count = re.subn(r'(server_name (?:card|tomato|tomatogame)\.beyour\.top;)', r'\1\n    ' + snippet, s)
    if count < 3:
        raise SystemExit('Expected website server blocks were not found')
    p.write_text(s)
PY
sudo nginx -t
sudo systemctl reload nginx

sudo install -d -o ecs-user -g ecs-user -m 700 /srv/beyour/backups
chmod 700 data
sudo install -m 644 deploy/beyour-backup.service /etc/systemd/system/beyour-backup.service
sudo install -m 644 deploy/beyour-backup.timer /etc/systemd/system/beyour-backup.timer
sudo systemctl daemon-reload
sudo systemctl enable --now beyour-backup.timer
sudo systemctl start beyour-backup.service
sudo systemctl is-active beyour-backup.timer
trap - ERR
sudo rm -rf "$rollback_dir"
