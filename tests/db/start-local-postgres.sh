#!/usr/bin/env bash
# ローカル PostgreSQL 16 を起動し、Supabase スタブ + 全マイグレーションを適用する（疑似環境）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PGDATA="${PGDATA_DIR:-/tmp/leihub-pgdata}"
PORT="${PGPORT:-55432}"
RUN_AS=()
if [ "$(id -u)" = "0" ]; then RUN_AS=(runuser -u postgres --); fi

if [ -d "$PGDATA" ]; then
  "${RUN_AS[@]}" "$PGBIN/pg_ctl" -D "$PGDATA" -m fast stop >/dev/null 2>&1 || true
  rm -rf "$PGDATA"
fi
mkdir -p "$PGDATA"; chown postgres:postgres "$PGDATA" 2>/dev/null || true
"${RUN_AS[@]}" "$PGBIN/initdb" -D "$PGDATA" -U postgres -A trust >/dev/null
"${RUN_AS[@]}" "$PGBIN/pg_ctl" -D "$PGDATA" -o "-p $PORT -k /tmp" -l "$PGDATA/server.log" -w start >/dev/null

PSQL=(psql -h /tmp -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q)
"${PSQL[@]}" -d postgres -c "create database leihub"
"${PSQL[@]}" -d leihub -f "$ROOT/tests/db/supabase_stub.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "apply $(basename "$f")"
  "${PSQL[@]}" -d leihub -f "$f"
done
echo "ready: postgres://postgres@localhost:$PORT/leihub (socket /tmp)"
