#!/usr/bin/env bash
# End-to-end over the PRODUCTION driver path (drizzle neon-http → HTTP → real Postgres), as the
# least-privilege login roles. Needs: a Postgres reachable on localhost:5432 and OWNER_URL, a URL
# for a role that owns a fresh, empty database and has CREATEROLE (as Neon's owner role does).
#   OWNER_URL=postgres://owner:pw@localhost:5432/e2e bash tests/e2e/neon-http.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${OWNER_URL:?OWNER_URL is required}"
DB=$(node -e 'console.log(new URL(process.argv[1]).pathname.slice(1))' "$OWNER_URL")

pass=0
fail() { echo "FAIL: $*"; exit 1; }
ok() { pass=$((pass + 1)); echo "ok   $*"; }

DATABASE_URL=$OWNER_URL npm run --silent db:migrate
DATABASE_URL=$OWNER_URL npm run --silent db:migrate # idempotent
psql "$OWNER_URL" -qv ON_ERROR_STOP=1 <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'e2e_manager') THEN
    CREATE ROLE e2e_manager LOGIN PASSWORD 'e2e-manager-local-only' IN ROLE app_manager; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'e2e_worker') THEN
    CREATE ROLE e2e_worker LOGIN PASSWORD 'e2e-worker-local-only' IN ROLE app_worker; END IF;
END $$;
SQL

node tests/e2e/neon-http-local.mjs &
EMU=$!
trap 'kill $EMU 2>/dev/null || true' EXIT
for _ in $(seq 50); do curl -s -o /dev/null "http://127.0.0.1:4444" -d '{}' && break; sleep 0.1; done

MGR="postgres://e2e_manager:e2e-manager-local-only@ep-local.neon.test/$DB"
WKR="postgres://e2e_worker:e2e-worker-local-only@ep-local.neon.test/$DB"
export NODE_OPTIONS="--import ./tests/e2e/neon-preload.mjs"
export DB_DRIVER=neon-http

# studio <expected exit> <args...>: runs the CLI as the manager role, checks the exit code.
studio() {
  local want=$1; shift
  set +e; OUT=$(DATABASE_URL=$MGR node --import tsx scripts/studio.ts "$@" 2>/dev/null); local got=$?; set -e
  [ "$got" = "$want" ] || fail "studio $* → exit $got (want $want): $OUT"
  ok "studio $* → $got"
}
sqlm() { curl -s -XPOST http://127.0.0.1:4444/sql -H "Neon-Connection-String: $1" -d "{\"query\":\"$2\",\"params\":[]}"; }

studio 0 channel init --title "قناة اختبار" --tz Asia/Riyadh
studio 0 policy set --json '{"max_shorts_per_week": 4}'
studio 1 policy set --json '{"max_uploads_per_day": 99}'
studio 0 run start --owner mgr-1
studio 2 run start --owner mgr-2
studio 0 next
studio 0 pause
studio 2 preflight
echo "$OUT" | grep -q "kill switch" || fail "pause not seen by preflight"
studio 0 resume
studio 0 idea add --title "أسرار النوم العميق" --format short
studio 2 idea add --title "أسرار النّوم العميق!" --format long
studio 0 budget spend

sqlm "$MGR" "select jsonb_typeof(policy) t from channel_policies" | grep -q '"string"' && fail "policy stored double-encoded"
ok "policies stored as JSON objects"

sqlm "$MGR" "select count(*) from encrypted_secrets" | grep -q "permission denied" || fail "manager can read encrypted_secrets"
ok "manager denied encrypted_secrets"
sqlm "$MGR" "delete from jobs" | grep -q "permission denied" || fail "manager can DELETE"
ok "manager denied DELETE"

psql "$OWNER_URL" -qtAc "select app.enqueue_job('system.noop', '{\"n\":1}', 'e2e-n1', p_kind => 'system')" >/dev/null
OUTW=$(DATABASE_URL=$WKR WORKER_TIME_BUDGET_MS=60000 WORKER_MIN_REMAINING_MS=5000 node --import tsx scripts/worker.ts 2>&1)
echo "$OUTW" | grep -q "processed 1 job" || fail "worker: $OUTW"
ok "worker (app_worker role) drained 1 job over HTTP"

set +e; OUTK=$(DATABASE_URL=$WKR ANTHROPIC_API_KEY=not-a-real-key node --import tsx scripts/worker.ts 2>&1); code=$?; set -e
[ "$code" != "0" ] && echo "$OUTK" | grep -q "Refusing to run" || fail "worker started with a paid-provider key present"
ok "worker refuses to start with a paid-provider key"

# Same worker over a plain Postgres TCP connection (Supabase-style URL, least-privilege role).
TCP="postgres://e2e_worker:e2e-worker-local-only@localhost:5432/$DB"
psql "$OWNER_URL" -qtAc "select app.enqueue_job('system.noop', '{\"n\":2}', 'e2e-n2', p_kind => 'system')" >/dev/null
CHECK=$(env -u NODE_OPTIONS -u DB_DRIVER DATABASE_URL=$TCP node --import tsx scripts/worker.ts --check 2>&1)
echo "$CHECK" | grep -q "pending=1" || fail "worker --check over TCP: $CHECK"
ok "worker --check over TCP sees 1 pending job"
OUTT=$(env -u NODE_OPTIONS -u DB_DRIVER DATABASE_URL=$TCP WORKER_TIME_BUDGET_MS=60000 WORKER_MIN_REMAINING_MS=5000 node --import tsx scripts/worker.ts 2>&1)
echo "$OUTT" | grep -q "processed 1 job" || fail "worker over TCP: $OUTT"
ok "worker over TCP drained 1 job"
USED=$(psql "$OWNER_URL" -qtAc "select coalesce(sum(used),0)::int from quota_ledger where provider='gha.minutes'")
[ "$USED" -ge 1 ] || fail "worker did not record minutes used ($USED)"
ok "worker recorded its free-minutes usage ($USED)"

echo "neon-http e2e: $pass checks passed"
