#!/usr/bin/env bash
# =============================================================================
# RESTORE DRILL: put a nightly backup into the STAGING project and prove it is
# complete. Run on the personal laptop (macOS, Linux or Git Bash), monthly.
#
#   STAGING_DB_URL='<staging Session pooler connection string, with password>' \
#   LIVE_PROJECT_REF='<live project ref>' \
#   bash scripts/restore-drill.sh amruta-XXXX.dump.age amruta-backup.key --wipe-staging <staging-project-ref>
#
# Needs: age, and the PostgreSQL 17 client tools (pg_restore, psql).
# The staging project must already have every migration (supabase db push).
#
# What it does:
#   1. decrypts the backup into a private temp folder (deleted at the end, always)
#   2. counts the rows of every table INSIDE the backup
#   3. in ONE transaction on staging: empties those tables, loads the backup with
#      triggers off (session_replication_role = replica, as Supabase's own restore
#      guide does), so audit/validation triggers do not fire twice or reject
#      history. Any error rolls everything back: staging is then unchanged.
#   4. counts the rows on staging again: every table must match the backup exactly
#   5. runs supabase/tests/verify_live.sql on staging (no problem rows expected)
# It never connects to the live project. Login sessions are not in backups, so
# after the drill everyone signs in to STAGING again. Photos/voice notes (Storage
# files) are not in database backups; their rows are, so on staging they show as
# missing pictures. That is expected.
# Tested on a local database by the drill in docs/PENDING_AND_TESTING.md (section Q).
# =============================================================================
set -euo pipefail

usage() { echo "Usage: STAGING_DB_URL=... bash $0 <backup.dump.age | backup.dump> <age-private-key | -> --wipe-staging <staging-project-ref>" >&2; exit 2; }
[ $# -eq 4 ] && [ "$3" = "--wipe-staging" ] || usage
backup=$1; key=$2; ref=$4
[ -n "${STAGING_DB_URL:-}" ] || { echo "Set STAGING_DB_URL (staging Session pooler URL)." >&2; exit 2; }
[ -s "$backup" ] || { echo "No such backup file: $backup" >&2; exit 2; }
case "$STAGING_DB_URL" in *"$ref"*) ;; *) echo "STAGING_DB_URL does not contain the project ref '$ref'. Stopping." >&2; exit 2 ;; esac
if [ -n "${LIVE_PROJECT_REF:-}" ]; then
  [ "$ref" != "$LIVE_PROJECT_REF" ] || { echo "'$ref' is the LIVE project. Stopping." >&2; exit 2; }
  case "$STAGING_DB_URL" in *"$LIVE_PROJECT_REF"*) echo "STAGING_DB_URL points at the LIVE project. Stopping." >&2; exit 2 ;; esac
fi
for tool in pg_restore psql; do command -v "$tool" >/dev/null || { echo "$tool not found: install the PostgreSQL 17 client tools." >&2; exit 2; }; done
here=$(cd "$(dirname "$0")" && pwd)
PSQL=(psql -X -q -v ON_ERROR_STOP=1 -d "$STAGING_DB_URL")   # -d, not a bare argument: Windows psql stops reading options at the first bare one

tmp=$(mktemp -d)
chmod 700 "$tmp"
trap 'rm -rf "$tmp"' EXIT

# 1. decrypt
case "$backup" in
  *.age)
    command -v age >/dev/null || { echo "age not found: install it (https://age-encryption.org)." >&2; exit 2; }
    [ -s "$key" ] || { echo "No such key file: $key" >&2; exit 2; }
    age -d -i "$key" -o "$tmp/backup.dump" "$backup"
    ;;
  *) cp "$backup" "$tmp/backup.dump" ;;   # already decrypted
esac

# 2. which tables, and how many rows each (the version bookkeeping of Supabase's own
#    auth/storage services is left alone: staging keeps its own)
pg_restore -l "$tmp/backup.dump" > "$tmp/all.list"
awk '/ TABLE DATA (auth schema_migrations|storage migrations) / { print ";" $0; next } { print }' "$tmp/all.list" > "$tmp/restore.list"
pg_restore -L "$tmp/restore.list" -f "$tmp/data.sql" "$tmp/backup.dump"
awk '/^COPY / { t = $2; n = 0; inside = 1; next }
     inside && /^\\\.$/ { print t, n; inside = 0; next }
     inside { n++ }' "$tmp/data.sql" | sort > "$tmp/expected.txt"
tables=$(awk '{ print $1 }' "$tmp/expected.txt" | paste -sd, -)
[ -n "$tables" ] || { echo "The backup holds no table data. Stopping." >&2; exit 1; }
echo "Backup: $(wc -l < "$tmp/expected.txt" | tr -d ' ') tables, $(awk '{ s += $2 } END { print s }' "$tmp/expected.txt") rows."

# staging must have every table (migrations pushed)
missing=$("${PSQL[@]}" -Atc "select string_agg(t, ', ') from unnest(string_to_array('$tables', ',')) t where to_regclass(t) is null")
[ -z "$missing" ] || { echo "Staging is missing tables: $missing. Push the migrations to staging first (supabase db push)." >&2; exit 1; }

# 3. wipe + load, all or nothing
echo "Restoring into staging ($ref)..."
"${PSQL[@]}" -1 -c "set session_replication_role = replica" -c "truncate table $tables cascade" -f "$tmp/data.sql" > /dev/null

# 4. compare
fail=0
while read -r t n <&3; do   # fd 3: psql must not swallow the list on stdin
  got=$("${PSQL[@]}" -Atc "select count(*) from $t" < /dev/null)
  if [ "$got" != "$n" ]; then echo "MISMATCH $t: backup $n, staging $got"; fail=1; fi
done 3< "$tmp/expected.txt"
[ $fail -eq 0 ] && echo "PASS: every table on staging matches the backup row for row." || echo "FAIL: see the mismatches above."

# 5. health check of rules and settings
if [ -f "$here/../supabase/tests/verify_live.sql" ]; then
  echo "verify_live.sql on staging (expect no problem rows):"
  "${PSQL[@]}" -f "$here/../supabase/tests/verify_live.sql"
fi
echo "Write today's date in your drill notes. Everyone signs in to staging again."
exit $fail
