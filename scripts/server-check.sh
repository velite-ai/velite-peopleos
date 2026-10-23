#!/usr/bin/env bash
# Read-only look at the server for backup planning: what runs, where the data lives, how much space is left, and whether any backup or schedule exists.
# Changes nothing and prints no passwords. Run on the server (Coolify terminal):  bash /opt/velite-deploy/src/scripts/server-check.sh
set -u
echo "=== 1. Date, disk and memory"; date; df -h / /data 2>/dev/null | sed -n '1,6p'; free -h | sed -n '1,2p'
echo; echo "=== 2. Velite containers"; docker ps --format '{{.Names}}\t{{.Status}}\t{{.Image}}' | grep -i t12xcc || echo "(none found)"
echo; echo "=== 3. Docker volumes (where the data lives)"; docker volume ls --format '{{.Name}}' | grep -i -E 't12xcc|minio|postgres|redis' || echo "(none found)"
echo; echo "=== 4. Size of the data volumes"; for v in $(docker volume ls --format '{{.Name}}' | grep -i -E 't12xcc|minio|postgres'); do printf '%s\t' "$v"; docker run --rm -v "$v":/v alpine du -sh /v 2>/dev/null | cut -f1 || echo "?"; done
echo; echo "=== 5. Database size and counts"
PG=$(docker ps --format '{{.Names}}' | grep -i '^postgres-t12xcc' | head -1)
if [ -n "$PG" ]; then docker exec "$PG" sh -c 'psql -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-postgres}" -Atc "select pg_size_pretty(pg_database_size(current_database())), (select count(*) from employees), (select count(*) from documents)"' 2>&1 | head -3; else echo "(postgres container not found)"; fi
echo; echo "=== 6. Backups and schedules that already exist"
ls -la /data/coolify/backups 2>/dev/null | head -15 || true
ls -la /opt/velite-backups 2>/dev/null | head -15 || echo "(no /opt/velite-backups folder yet)"
echo "-- cron jobs:"; (crontab -l 2>/dev/null; ls /etc/cron.d 2>/dev/null) | grep -v '^#' | head -15 || true
echo "-- Hetzner snapshots/backups are not visible from the server; check the Hetzner Cloud console (Server > Backups / Snapshots)."
echo; echo "=== 7. Settings present in the app container (names only, no values)"
docker exec "$(docker ps --format '{{.Names}}' | grep -i '^web-t12xcc' | head -1)" sh -c 'for v in REQUIRE_MFA SESSION_HOURS PAYROLL_APPROVAL_MODE MALWARE_SCAN_URL DATA_ENCRYPTION_KEY AUTH_SECRET STORAGE_BUCKET; do if [ -n "$(printenv $v)" ]; then echo "$v = set"; else echo "$v = NOT set"; fi; done' 2>&1
echo; echo "Done. Nothing was changed."
