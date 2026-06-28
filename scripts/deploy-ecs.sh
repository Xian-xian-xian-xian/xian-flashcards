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

upload_committed_files() {
  local current_revision remote_revision incremental
  current_revision=$(git rev-parse HEAD)
  remote_revision=$(remote "cat '$REMOTE_DIR/.deploy-revision' 2>/dev/null || true" | tr -d '\r\n')
  incremental=false

  if [[ -n "$remote_revision" ]] && git cat-file -e "$remote_revision^{commit}" 2>/dev/null && git merge-base --is-ancestor "$remote_revision" HEAD; then
    incremental=true
  fi

  if [[ "$incremental" == true ]]; then
    local changed=()
    local deleted=()
    local path
    while IFS= read -r path; do
      [[ -n "$path" ]] && changed+=("$path")
    done < <(git diff --name-only --diff-filter=ACMRT "$remote_revision" HEAD)
    while IFS= read -r path; do
      [[ -n "$path" ]] && deleted+=("$path")
    done < <(git diff --name-only --diff-filter=D "$remote_revision" HEAD)

    echo "incremental_from=$remote_revision changed=${#changed[@]} deleted=${#deleted[@]}"
    if (( ${#changed[@]} > 0 )); then
      git archive HEAD -- "${changed[@]}" | "${ssh_base[@]}" "$ECS_HOST" "tar -x -C '$REMOTE_DIR'"
    fi
    if (( ${#deleted[@]} > 0 )); then
      printf '%s\0' "${deleted[@]}" | "${ssh_base[@]}" "$ECS_HOST" "cd '$REMOTE_DIR'; xargs -0 rm -f --"
    fi
  else
    echo "full_upload=true"
    git archive HEAD | "${ssh_base[@]}" "$ECS_HOST" "tar -x -C '$REMOTE_DIR'"
  fi

  remote "printf '%s\n' '$current_revision' > '$REMOTE_DIR/.deploy-revision'"
}

trap close_master EXIT

step "open ssh control connection" open_master
step "backup sqlite database" remote "set -e; ts=\$(date +%Y%m%d%H%M%S); if [ -f '$REMOTE_DIR/data/flashcards.sqlite' ]; then cp '$REMOTE_DIR/data/flashcards.sqlite' /root/flashcards.sqlite.pre-release.\$ts; fi; echo backup_ts=\$ts"
step "upload committed files" upload_committed_files
step "install dependencies" remote "cd '$REMOTE_DIR'; pnpm install"
step "build production assets" remote "cd '$REMOTE_DIR'; pnpm build"
step "restart pm2" remote "cd '$REMOTE_DIR'; pm2 restart flashcards --update-env; pm2 save"
step "verify health" remote "curl -sS http://127.0.0.1:4174/api/health"
