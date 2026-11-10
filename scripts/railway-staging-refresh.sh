#!/usr/bin/env bash
# KP Front — make a Railway staging environment a copy of production again.
#
#   ./scripts/railway-staging-refresh.sh              # production → staging, asks first
#   ./scripts/railway-staging-refresh.sh --yes        # no question (for a scheduled refresh)
#   ./scripts/railway-staging-refresh.sh --db-only    # skip the storage volume (fast)
#
# Staging is a second Railway ENVIRONMENT of the same project (`railway environment new staging
# --duplicate production`), deployed from the `staging` branch, with its own Postgres, its own
# volume and its own URL — so an installed staging PWA is a separate app from the prod one.
# This script copies prod's database and storage volume into it and then CUTS every path by
# which a copy of prod reaches real people. Everything in staging is overwritten; test data
# made there is gone afterwards.
#
# Production is only READ: `pg_dump` and `tar -c` over `railway ssh`, nothing else. The local
# key must be registered once (`railway ssh keys add`).
#
# ⚠️ What a verbatim copy of prod would do, and what this script does about it:
#   · push_subscriptions are prod's real devices — staging would send them «Neuer Einsatz» on
#     every Divera alarm it polls. → emptied; staging has its own VAPID pair in its variables.
#   · alarms.webhooks would fire a second time per alarm. → emptied.
#   · healthcheck_ping_url would keep prod's dead-man's switch green while prod is down. →
#     stored credential deleted; the variable must be empty in staging too.
#   · print_agent_secret / the two inbound webhook secrets are prod's. → stored copies
#     deleted; staging's variables carry its own values.
#   · identity.appName becomes «KP Staging», so the installed app and every head say which
#     one this is.
# The restore and those cuts are ONE transaction: the app sees the empty database or the cut
# copy, never prod's push targets. Read-only feeds (Divera poll, Traccar, SharePoint, STT,
# CARTO) are deliberately kept – staging sees the same alarms and vehicles as prod.
#
# ⚠️ SECRET_KEY must be the same in both environments (the duplicate copies it): it peppers
# every PIN and seals the stored credentials. A different key = nobody can log in to staging.
# shellcheck disable=SC2016  # single-quoted commands expand $DATABASE_URL on the remote side
set -euo pipefail

SOURCE_ENV="${SOURCE_ENV:-production}"
TARGET_ENV="${TARGET_ENV:-staging}"
SERVICE="${SERVICE:-kp-front}"
STAGING_APP_NAME="${STAGING_APP_NAME:-KP Staging}"
ASSUME_YES=0
DB_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --yes|-y) ASSUME_YES=1 ;;
    --db-only) DB_ONLY=1 ;;
    -h|--help) sed -n '2,32p' "$0"; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

if [ "$TARGET_ENV" = "production" ] || [ "$TARGET_ENV" = "$SOURCE_ENV" ]; then
  echo "refusing: the target environment is '$TARGET_ENV'." >&2
  exit 2
fi

# `railway` prints a config-as-code deprecation notice on every call; keep only what matters.
quiet() { grep -v -E 'warning: Config as Code|→ Migrate:|Existing files keep working|Using SSH key' >&2 || true; }
on()    { local env="$1"; shift; railway ssh -e "$env" -s "$SERVICE" -- "$*" 2> >(quiet); }

# The staging variables must not point at prod's monitor: an env value outranks the stored one
# we delete below, so a copied HEALTHCHECK_PING_URL would undo the cut.
if railway variables -e "$TARGET_ENV" -s "$SERVICE" --kv 2>/dev/null | grep -q '^HEALTHCHECK_PING_URL=.'; then
  echo "refusing: HEALTHCHECK_PING_URL is set in '$TARGET_ENV' – it would ping prod's monitor." >&2
  exit 2
fi

if [ "$ASSUME_YES" != 1 ]; then
  printf "Overwrite the database%s of '%s' with a copy of '%s'? [y/N] " \
    "$([ "$DB_ONLY" = 1 ] || echo ' and storage volume')" "$TARGET_ENV" "$SOURCE_ENV"
  read -r answer
  [ "$answer" = y ] || [ "$answer" = Y ] || { echo "aborted."; exit 1; }
fi

WORK="$(mktemp -d)"
chmod 700 "$WORK"
trap 'rm -rf "$WORK"' EXIT

# ─── Storage ──────────────────────────────────────────────────────────────────────────────
# First, so the database never points at blobs that are not there yet. `backups/` stays
# staging's own (its pre-migration dumps are of the staging database).
if [ "$DB_ONLY" != 1 ]; then
  echo "→ storage: $SOURCE_ENV → $TARGET_ENV (a few GB, takes a while)"
  on "$TARGET_ENV" 'find /mnt/data/storage -mindepth 1 -maxdepth 1 ! -name backups -exec rm -rf {} +'
  # In batches of ~300 MB, each leg retried: a copy is read from ONE prod container, and a prod
  # deploy mid-copy retires it (24.09.2026: a merge to main cut a single 5-GB stream at ~2 GB).
  # Each batch lands on local disk and is checked before it is sent on, so a broken read is
  # caught as a broken read. A batch is a list of paths two levels down (plans/<object>,
  # plan-tiles/<plan>, …) plus any loose top-level files; it travels as an argument, base64.
  on "$SOURCE_ENV" 'cd /mnt/data/storage && { find . -mindepth 2 -maxdepth 2 ! -path "./backups/*" -exec du -sk {} + ; find . -mindepth 1 -maxdepth 1 -type f -exec du -sk {} + ; }' \
    | awk -v dir="$WORK" -F '\t' '
        { if (sum > 0 && (sum + $1 > 300000 || lines >= 400)) { n++; sum = 0; lines = 0 }
          sum += $1; lines++; print $2 > (dir "/batch." sprintf("%04d", n)) }'
  total="$(find "$WORK" -name 'batch.*' | wc -l)"
  [ "$total" -gt 0 ] || { echo "could not list $SOURCE_ENV's storage – nothing was changed." >&2; exit 1; }
  retry() {  # retry <what> <command…>
    local what="$1" attempt; shift
    for attempt in 1 2 3 4 5; do
      "$@" && return 0
      echo "  $what failed ($attempt/5)" >&2
      sleep 30  # a prod deploy swaps the container in a minute or two
    done
    echo "$what failed five times – the database was NOT touched." >&2
    exit 1
  }
  fetch() { on "$SOURCE_ENV" "echo $(base64 -w0 < "$1") | base64 -d | tar -C /mnt/data/storage -cf - -T -" > "$WORK/b.tar" && tar -tf "$WORK/b.tar" > /dev/null; }
  send()  { on "$TARGET_ENV" 'tar -C /mnt/data/storage -xf -' < "$WORK/b.tar"; }
  i=0
  for batch in "$WORK"/batch.*; do
    i=$((i + 1))
    retry "reading batch $i" fetch "$batch"
    retry "writing batch $i" send
    echo "  batch $i/$total ok ($(du -m "$WORK/b.tar" | cut -f1) MB)"
  done
  rm -f "$WORK/b.tar"
  src="$(on "$SOURCE_ENV" 'cd /mnt/data/storage && find . -path ./backups -prune -o -type f -print | wc -l')"
  dst="$(on "$TARGET_ENV" 'cd /mnt/data/storage && find . -path ./backups -prune -o -type f -print | wc -l')"
  echo "  files: $SOURCE_ENV $src, $TARGET_ENV $dst"
  [ "$src" = "$dst" ] || echo "  ⚠️ counts differ – prod may have written during the copy; rerun if it matters." >&2
fi

# ─── Database ─────────────────────────────────────────────────────────────────────────────
echo "→ database: $SOURCE_ENV → $TARGET_ENV"
on "$SOURCE_ENV" 'pg_dump "$DATABASE_URL" --no-owner --no-acl' > "$WORK/dump.sql"
grep -q 'CREATE TABLE public.deployment_config' "$WORK/dump.sql" \
  || { echo "the dump does not look like a kp-front database – nothing was restored." >&2; exit 1; }

# The whole schema goes, not just what the dump names: a staging branch that ran a newer
# migration has tables prod does not, and they would make start.sh's upgrade collide.
app_name_json="$(printf '%s' "$STAGING_APP_NAME" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')"
{
  echo "SET lock_timeout = '30s';  -- a busy staging app fails the run instead of hanging it"
  echo 'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;'
  cat "$WORK/dump.sql"
} > "$WORK/db.sql"
cat >> "$WORK/db.sql" <<SQL

-- ─── staging cuts (railway-staging-refresh.sh) ───
SET search_path = public;  -- the dump emptied it
TRUNCATE push_subscriptions, print_jobs;
DELETE FROM integration_credentials WHERE name IN (
  'healthcheck_ping_url', 'print_agent_secret', 'alarm_webhook_secret', 'divera_webhook_secret',
  'vapid_public_key', 'vapid_private_key', 'vapid_subject');
UPDATE deployment_config SET config_json =
  jsonb_set(
    jsonb_set(coalesce(config_json, '{}'::jsonb), '{identity}',
              coalesce(config_json->'identity', '{}'::jsonb) || jsonb_build_object('appName', '$app_name_json'::jsonb)),
    '{alarms}', coalesce(config_json->'alarms', '{}'::jsonb) || '{"webhooks": []}'::jsonb);
SQL

on "$TARGET_ENV" 'psql "$DATABASE_URL" --single-transaction -v ON_ERROR_STOP=1 -q -o /dev/null -f -' < "$WORK/db.sql"

on "$TARGET_ENV" 'psql "$DATABASE_URL" -At -F ", " -f -' <<'SQL'
SELECT '  push subscriptions ' || (SELECT count(*) FROM push_subscriptions),
       'webhooks ' || jsonb_array_length(config_json->'alarms'->'webhooks'),
       'app name «' || (config_json->'identity'->>'appName') || '»',
       'incidents ' || (SELECT count(*) FROM incidents)
  FROM deployment_config;
SQL

# ─── Restart ──────────────────────────────────────────────────────────────────────────────
# Not for safety – the cuts were in the same transaction, and the credential cache re-reads
# within 30 s – but so start.sh migrates and nothing holds the old config. `railway restart`
# hung without output here (24.09.2026); `redeploy` of the same build does the same job.
# ⚠️ Keep the `staging` branch on top of main: prod's database may already carry a migration
# that older staging code does not know, and then staging does not boot.
echo "→ redeploying $SERVICE in $TARGET_ENV"
timeout 120 railway redeploy -e "$TARGET_ENV" -s "$SERVICE" -y < /dev/null 2> >(quiet) >/dev/null \
  || echo "  redeploy did not confirm – check: railway deployment list -e $TARGET_ENV -s $SERVICE" >&2
echo "done."
