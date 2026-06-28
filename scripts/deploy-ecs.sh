#!/usr/bin/env bash
set -euo pipefail

ECS_HOST="${ECS_HOST:-root@121.43.195.214}"
ECS_KEY="${ECS_KEY:-$HOME/.ssh/codex_aliyun_flashcards}"
REMOTE_DIR="${REMOTE_DIR:-/root/flashcards}"
CONTROL_PATH="${CONTROL_PATH:-/tmp/xfcecs-%C}"

ssh_base=(
  ssh
  -i "$ECS_KEY"
  -o IdentitiesOnly=yes
  -o ControlMaster=auto
  -o ControlPersist=120
  -o ControlPath="$CONTROL_PATH"
)

step() {
  local name="$1"
  shift
  printf '\n==> %s\n' "$name"
  local start
  start=$(date +%s)
  "$@"
  local end
  end=$(date +%s)
  printf '<== %s (%ss)\n' "$name" "$((end - start))"
}

remote() {
  "${ssh_base[@]}" "$ECS_HOST" "$@"
}

open_master() {
  if "${ssh_base[@]}" -O check "$ECS_HOST" >/dev/null 2>&1; then
    return
  fi
  "${ssh_base[@]}" -MNf "$ECS_HOST"
}

close_master() {
  "${ssh_base[@]}" -O exit "$ECS_HOST" >/dev/null 2>&1 || true
}

trap close_master EXIT

step "open ssh control connection" open_master
step "backup sqlite database" remote "set -e; ts=\$(date +%Y%m%d%H%M%S); if [ -f '$REMOTE_DIR/data/flashcards.sqlite' ]; then cp '$REMOTE_DIR/data/flashcards.sqlite' /root/flashcards.sqlite.pre-release.\$ts; fi; echo backup_ts=\$ts"
step "upload committed files" bash -c "git archive HEAD | ssh -i '$ECS_KEY' -o IdentitiesOnly=yes -o ControlMaster=auto -o ControlPersist=120 -o ControlPath='$CONTROL_PATH' '$ECS_HOST' \"tar -x -C '$REMOTE_DIR'\""
step "install dependencies" remote "cd '$REMOTE_DIR'; pnpm install"
step "build production assets" remote "cd '$REMOTE_DIR'; pnpm build"
step "restart pm2" remote "cd '$REMOTE_DIR'; pm2 restart flashcards --update-env; pm2 save"
step "verify health" remote "curl -sS http://127.0.0.1:4174/api/health"
