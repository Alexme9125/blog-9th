#!/usr/bin/env bash
set -euo pipefail
umask 077

usage() {
  cat <<'EOF'
Usage: scripts/backup.sh

Creates a compressed backup containing a PostgreSQL custom-format dump and the
application media volume. The Compose db and app services must already be running.

Optional environment variables:
  BACKUP_DIR    Destination directory (default: ./backups)
  COMPOSE_FILE  Compose file path (default: ./compose.yaml)
EOF
}

die() {
  printf 'backup: %s\n' "$*" >&2
  exit 1
}

if [[ $# -ne 0 ]]; then
  usage >&2
  exit 2
fi

root_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
compose_file="${COMPOSE_FILE:-$root_dir/compose.yaml}"
backup_dir="${BACKUP_DIR:-$root_dir/backups}"

[[ -f "$compose_file" ]] || die "Compose file not found: $compose_file"
command -v docker >/dev/null 2>&1 || die "Docker is required."
docker compose -f "$compose_file" version >/dev/null 2>&1 || die "Docker Compose v2 is required."

mkdir -p "$backup_dir"
backup_dir="$(CDPATH= cd -- "$backup_dir" && pwd -P)"

compose() {
  docker compose -f "$compose_file" "$@"
}

is_active_media_filename() {
  [[ "$1" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.(jpg|png|webp|avif)$ ]]
}

prune_staged_media() {
  local staged_item filename

  # Restore retains hidden rollback directories inside MEDIA_ROOT. Preserve the
  # volume untouched, but archive only the active storage-key files so a later
  # restore always passes its strict media allowlist.
  while IFS= read -r -d '' staged_item; do
    filename="${staged_item##*/}"
    if [[ -f "$staged_item" ]] && is_active_media_filename "$filename"; then
      continue
    fi
    rm -rf -- "$staged_item"
  done < <(find "$stage_dir/media" -mindepth 1 -maxdepth 1 -print0)
}

db_container="$(compose ps -q db)"
app_container="$(compose ps -q app)"
[[ -n "$db_container" ]] || die "The db service is not running."
[[ -n "$app_container" ]] || die "The app service is not running."
[[ "$(docker inspect --format '{{.State.Running}}' "$db_container")" == "true" ]] || die "The db service is not running."
[[ "$(docker inspect --format '{{.State.Running}}' "$app_container")" == "true" ]] || die "The app service is not running."

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
archive="$backup_dir/darwin-journal-$timestamp.tar.gz"
archive_tmp="$backup_dir/.darwin-journal-$timestamp.tar.gz.tmp"
stage_dir="$(mktemp -d "$backup_dir/.darwin-backup.XXXXXX")"
app_stopped=false

cleanup() {
  local exit_code_local=$?
  rm -rf "$stage_dir" || true
  if [[ -n "$archive_tmp" ]]; then
    rm -f "$archive_tmp" || true
  fi
  if [[ "$app_stopped" == "true" ]]; then
    printf 'backup: restarting app after backup attempt.\n' >&2
    compose start app >&2 || true
  fi
  trap - EXIT
  exit "$exit_code_local"
}
trap cleanup EXIT

[[ ! -e "$archive" ]] || die "Backup archive already exists: $archive"

# Freeze application writes before taking both parts of the backup. Docker can
# copy filesystem contents from this stopped container, while PostgreSQL stays
# available for pg_dump.
app_stopped=true
compose stop app

compose exec -T db sh -ceu 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' > "$stage_dir/database.dump"
[[ -s "$stage_dir/database.dump" ]] || die "Database dump is empty."

mkdir -p "$stage_dir/media"
docker cp "$app_container:/app/data/media/." "$stage_dir/media"
prune_staged_media

compose start app
app_stopped=false

printf '%s\n' \
  'format=darwin-journal-backup-v1' \
  "created_at=$timestamp" \
  'database_service=db' \
  'media_path=/app/data/media' \
  > "$stage_dir/manifest.txt"

tar -C "$stage_dir" -czf "$archive_tmp" database.dump media manifest.txt
tar -tzf "$archive_tmp" > "$stage_dir/archive-members.txt"
grep -Fx 'database.dump' "$stage_dir/archive-members.txt" >/dev/null || die "Archive validation failed: database.dump is missing."
grep -Fx 'manifest.txt' "$stage_dir/archive-members.txt" >/dev/null || die "Archive validation failed: manifest.txt is missing."
grep -Eq '^media(/|$)' "$stage_dir/archive-members.txt" || die "Archive validation failed: media is missing."

mv "$archive_tmp" "$archive"
archive_tmp=""
chmod 600 "$archive"

printf 'Backup created: %s\n' "$archive"
