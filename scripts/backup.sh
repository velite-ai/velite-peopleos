#!/bin/sh
set -eu

: "${POSTGRES_DB:?POSTGRES_DB is required}"
: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"
: "${RESTIC_REPOSITORY:?RESTIC_REPOSITORY is required}"
: "${RESTIC_PASSWORD:?RESTIC_PASSWORD is required}"

export PGPASSWORD="$POSTGRES_PASSWORD"
backup_dir="$(mktemp -d)"
trap 'rm -rf "$backup_dir"' EXIT INT TERM
dump_file="$backup_dir/velite-hr-$(date -u +%Y%m%dT%H%M%SZ).dump"

pg_dump --host=postgres --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --format=custom --no-owner --file="$dump_file"
restic snapshots >/dev/null 2>&1 || restic init
restic backup "$dump_file" --tag velite-hr-postgres
restic forget --tag velite-hr-postgres --keep-daily 14 --keep-weekly 8 --keep-monthly 12 --prune
