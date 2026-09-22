#!/usr/bin/env bash
set -euo pipefail
umask 077

readonly confirmation_flag='--confirm=restore-darwin'
readonly postgres_image='postgres:17.11-bookworm'
readonly media_root='/app/data/media'

usage() {
  cat <<'EOF'
Usage: scripts/restore.sh /absolute/or/relative/backup.tar.gz --confirm=restore-darwin

The explicit confirmation flag is required because this restores the primary
database and media. The archive is first validated and extracted into a new
temporary directory; the PostgreSQL dump is checked in an isolated container.

The current database and media are retained for rollback after a successful
restore. Remove them manually only after validating the restored application.
EOF
}

die() {
  printf 'restore: %s\n' "$*" >&2
  exit 1
}

if [[ $# -ne 2 || "$2" != "$confirmation_flag" ]]; then
  usage >&2
  exit 2
fi

archive_input="$1"
[[ -f "$archive_input" ]] || die "Backup archive not found: $archive_input"
archive="$(CDPATH= cd -- "$(dirname -- "$archive_input")" && pwd -P)/$(basename -- "$archive_input")"

root_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
compose_file="${COMPOSE_FILE:-$root_dir/compose.yaml}"
[[ -f "$compose_file" ]] || die "Compose file not found: $compose_file"

compose() {
  docker compose -f "$compose_file" "$@"
}

is_media_member() {
  [[ "$1" =~ ^media/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.(jpg|png|webp|avif)$ ]]
}

validate_member_path() {
  local member="$1"

  [[ -n "$member" ]] || die 'Archive contains an empty member path.'
  [[ "$member" != *\\* ]] || die 'Archive contains a backslash path separator.'
  [[ "$member" != *[[:cntrl:]]* ]] || die 'Archive contains a control character in a member path.'

  # Reject traversal before the strict allowlist. The allowlist matches the
  # storage-key format enforced by src/lib/cms/media.ts.
  case "/$member/" in
    */./*|*/../*) die 'Archive contains an unsafe path component.' ;;
  esac

  case "$member" in
    database.dump|manifest.txt|media|media/) ;;
    *) is_media_member "$member" || die 'Archive contains an unexpected or unsafe path.' ;;
  esac
}

# Keep the verification directory in the repository so Docker Desktop can mount
# it during pg_restore validation, then remove only this exact mktemp directory.
stage_dir="$(mktemp -d "$root_dir/.darwin-restore.XXXXXX")"
restore_dir="$stage_dir/extracted"
app_stopped=false
database_swap_started=false
media_swapped=false

cleanup() {
  local exit_code_local=$?
  # An archive can carry restrictive modes. Make only the fresh staging tree
  # writable before removing it; no user data path is ever passed here.
  chmod -R u+rwX "$stage_dir" 2>/dev/null || true
  rm -rf "$stage_dir" || true
  if [[ "$exit_code_local" -ne 0 && "$app_stopped" == "true" ]]; then
    if [[ "$database_swap_started" == "true" && "$media_swapped" != "true" ]]; then
      printf '%s\n' \
        'restore: the database switch may have started before media restoration failed.' \
        'restore: app is intentionally left stopped to avoid serving mismatched database and media state.' \
        'restore: inspect the retained darwin_before_restore_* database and .before_restore_* media before manually restarting app.' >&2
    else
      printf 'restore: restarting app after failed restore attempt.\n' >&2
      compose start app >&2 || true
    fi
  fi
  trap - EXIT
  exit "$exit_code_local"
}
trap cleanup EXIT

tar -tzf "$archive" > "$stage_dir/archive-members.txt" || die "Archive is not a readable gzip tarball."
tar -tvzf "$archive" > "$stage_dir/archive-details.txt" || die "Archive details could not be read."

while IFS= read -r member; do
  validate_member_path "$member"
done < "$stage_dir/archive-members.txt"

if sort "$stage_dir/archive-members.txt" | uniq -d | grep -q .; then
  die 'Archive contains duplicate member paths.'
fi

if awk '$1 !~ /^[-d]/ { exit 1 }' "$stage_dir/archive-details.txt"; then
  :
else
  die "Archive must not contain links or special files."
fi

grep -Fx 'database.dump' "$stage_dir/archive-members.txt" >/dev/null || die "Archive is missing database.dump."
grep -Fx 'manifest.txt' "$stage_dir/archive-members.txt" >/dev/null || die "Archive is missing manifest.txt."
grep -Eq '^media(/|$)' "$stage_dir/archive-members.txt" || die "Archive is missing media."

mkdir "$restore_dir"
tar -xzf "$archive" -C "$restore_dir"
chmod -R u+rwX "$restore_dir" || die 'Archive extraction permissions could not be normalized.'

# Validate the extracted filesystem with NUL-delimited paths as a second pass.
# This catches control characters that line-oriented `tar -t` output cannot
# represent safely. Extraction only happens in the fresh directory above.
while IFS= read -r -d '' extracted_path; do
  relative_path="${extracted_path#"$restore_dir"/}"
  validate_member_path "$relative_path"
  case "$relative_path" in
    media)
      [[ -d "$extracted_path" ]] || die 'Archive media entry is not a directory.'
      ;;
    database.dump|manifest.txt)
      [[ -f "$extracted_path" ]] || die 'Archive metadata entry is not a regular file.'
      ;;
    *)
      [[ -f "$extracted_path" ]] || die 'Archive media entry is not a regular file.'
      ;;
  esac
done < <(find "$restore_dir" -mindepth 1 -print0)

[[ -s "$restore_dir/database.dump" ]] || die "Extracted database dump is empty."
[[ -d "$restore_dir/media" ]] || die "Extracted media directory is missing."
grep -Fx 'format=darwin-journal-backup-v1' "$restore_dir/manifest.txt" >/dev/null || die "Archive format is not supported."

# Archive validation intentionally precedes Docker checks so malformed input is
# rejected without requiring a running container engine.
command -v docker >/dev/null 2>&1 || die "Docker is required."
docker compose -f "$compose_file" version >/dev/null 2>&1 || die "Docker Compose v2 is required."

# Dump inspection is read-only and needs no network access. Keep the isolated
# validator off the Compose network while it handles untrusted archive input.
docker run --rm --network none -v "$restore_dir:/restore:ro" "$postgres_image" pg_restore --list /restore/database.dump >/dev/null || die "PostgreSQL dump validation failed."

db_container="$(compose ps -q db)"
app_container="$(compose ps -q app)"
[[ -n "$db_container" ]] || die "The db service is not running."
[[ -n "$app_container" ]] || die "The app service is not running."
[[ "$(docker inspect --format '{{.State.Running}}' "$db_container")" == "true" ]] || die "The db service is not running."
[[ "$(docker inspect --format '{{.State.Running}}' "$app_container")" == "true" ]] || die "The app service is not running."

restore_id="$(date -u +%Y%m%d%H%M%S)_$$"
restore_database="darwin_restore_$restore_id"
previous_database="darwin_before_restore_$restore_id"
staged_media=".restore_$restore_id"
previous_media=".before_restore_$restore_id"

# Stage media while the app is still serving the existing version. The hidden
# directory is only swapped after the database restore succeeds.
docker exec -u 0 "$app_container" mkdir -p "$media_root/$staged_media"
docker cp "$restore_dir/media/." "$app_container:$media_root/$staged_media/"
docker exec -u 0 "$app_container" chown -R 1001:1001 "$media_root/$staged_media"

compose stop app
app_stopped=true

# Restore into a new database first. The existing database is renamed only once
# pg_restore and a connection check have completed successfully.
docker exec -e RESTORE_DATABASE="$restore_database" "$db_container" sh -ceu '
  exec createdb -U "$POSTGRES_USER" -T template0 "$RESTORE_DATABASE"
'
docker exec -i -e RESTORE_DATABASE="$restore_database" "$db_container" sh -ceu '
  exec pg_restore -U "$POSTGRES_USER" -d "$RESTORE_DATABASE" --exit-on-error --no-owner --no-privileges
' < "$restore_dir/database.dump"
docker exec -e RESTORE_DATABASE="$restore_database" "$db_container" sh -ceu '
  psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$RESTORE_DATABASE" -tAc "SELECT 1" | grep -qx 1
'

database_swap_started=true
docker exec \
  -e RESTORE_DATABASE="$restore_database" \
  -e PREVIOUS_DATABASE="$previous_database" \
  "$db_container" sh -ceu '
    psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres \
      -v current_database="$POSTGRES_DB" \
      -v restore_database="$RESTORE_DATABASE" \
      -v previous_database="$PREVIOUS_DATABASE" <<SQL
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = :'\''current_database'\''
  AND pid <> pg_backend_pid();
ALTER DATABASE :"current_database" RENAME TO :"previous_database";
ALTER DATABASE :"restore_database" RENAME TO :"current_database";
SQL
  '

# The helper mounts the same named volume as app. It retains the old media in a
# hidden rollback directory instead of deleting it.
compose run --rm --no-deps --user root \
  -e STAGED_MEDIA="$staged_media" \
  -e PREVIOUS_MEDIA="$previous_media" \
  --entrypoint /bin/sh app -ceu '
    stage="$MEDIA_ROOT/$STAGED_MEDIA"
    previous="$MEDIA_ROOT/$PREVIOUS_MEDIA"
    test -d "$stage"
    mkdir "$previous"

    for item in "$MEDIA_ROOT"/.[!.]* "$MEDIA_ROOT"/..?* "$MEDIA_ROOT"/*; do
      [ -e "$item" ] || continue
      [ "$item" = "$stage" ] && continue
      [ "$item" = "$previous" ] && continue
      mv "$item" "$previous"/
    done

    for item in "$stage"/.[!.]* "$stage"/..?* "$stage"/*; do
      [ -e "$item" ] || continue
      mv "$item" "$MEDIA_ROOT"/
    done

    rmdir "$stage"
    chown -R 1001:1001 "$MEDIA_ROOT"
  '

media_swapped=true

compose start app
app_stopped=false

printf '%s\n' \
  'Restore completed.' \
  "Rollback database retained as: $previous_database" \
  "Rollback media retained in: $media_root/$previous_media"
