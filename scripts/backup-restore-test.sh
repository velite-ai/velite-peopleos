#!/usr/bin/env bash
# Proves the nightly backup can really be restored. It downloads the newest Velite database backup from Backblaze (the copy the 2 AM job uploads),
# restores it into a throw-away database container, counts people and documents, and removes the container again.
# The live database is never touched: the test runs in its own container with its own empty storage.
# Run on the server (Coolify terminal):  bash /opt/velite-deploy/src/scripts/backup-restore-test.sh
set -uo pipefail
REMOTE="${BACKUP_REMOTE:-b2:velite/pg-backups}"
WORK="$(mktemp -d /var/tmp/restore-test.XXXXXX)"; NAME="velite-restore-test-$$"
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1; rm -rf "$WORK"; }
trap cleanup EXIT

echo "=== 1. Newest Velite database backup in $REMOTE"
LATEST="$(rclone lsf "$REMOTE" 2>/dev/null | grep '^postgres-t12xcc' | sort | tail -1)"
[ -n "$LATEST" ] || { echo "FAIL: no backup file named postgres-t12xcc... found in $REMOTE"; exit 1; }
echo "$LATEST"
rclone lsl "$REMOTE" 2>/dev/null | grep -F "$LATEST" | awk '{print "size " $1 " bytes, saved " $2 " " $3}'
echo "How many days of Velite database backups are kept:"; rclone lsf "$REMOTE" | grep -c '^postgres-t12xcc'

echo; echo "=== 2. Download it"
rclone copy "$REMOTE/$LATEST" "$WORK/" || { echo "FAIL: download failed"; exit 1; }
[ -s "$WORK/$LATEST" ] || { echo "FAIL: the downloaded file is empty"; exit 1; }
gzip -t "$WORK/$LATEST" && echo "file is a valid gzip" || { echo "FAIL: the file is damaged"; exit 1; }

echo; echo "=== 3. Restore into a throw-away database container (not the live one)"
docker run -d --name "$NAME" -e POSTGRES_PASSWORD=restoretest postgres:17-alpine >/dev/null || { echo "FAIL: could not start the test container"; exit 1; }
for i in $(seq 1 30); do docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
gunzip -c "$WORK/$LATEST" | docker exec -i "$NAME" psql -U postgres -q -v ON_ERROR_STOP=0 >"$WORK/restore.log" 2>&1
echo "restore finished (messages such as 'role already exists' are normal); lines in the log: $(wc -l < "$WORK/restore.log")"

echo; echo "=== 4. What came back"
for DB in $(docker exec "$NAME" psql -U postgres -Atc "select datname from pg_database where datname not in ('postgres','template0','template1')"); do
  HAS="$(docker exec "$NAME" psql -U postgres -d "$DB" -Atc "select to_regclass('public.employees') is not null" 2>/dev/null)"
  if [ "$HAS" = "t" ]; then
    echo "database $DB:"
    docker exec "$NAME" psql -U postgres -d "$DB" -Atc "select 'people', count(*) from employees union all select 'documents', count(*) from documents union all select 'attendance days', count(*) from attendance_days union all select 'pay records', count(*) from employee_compensation union all select 'audit entries', count(*) from audit_events" | sed 's/|/: /'
    docker exec "$NAME" psql -U postgres -d "$DB" -Atc "select 'newest change in the backup: ' || max(occurred_at)::text from audit_events"
    FOUND=1
  fi
done
[ "${FOUND:-0}" = 1 ] || { echo "FAIL: no Velite data found in the restored backup"; exit 1; }

echo; echo "Compare these numbers with the live system (the Data check / data-health report). A backup is a day old, so small differences are normal."
echo "The test container has been removed. Nothing live was changed."
