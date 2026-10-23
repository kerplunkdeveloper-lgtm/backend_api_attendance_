#!/usr/bin/env bash
set -Eeuo pipefail

SHA="${1:?commit SHA required}"
BACKUP_BUCKET="${2:?backup bucket required}"
REGION="${3:?AWS region required}"
REPO="https://github.com/kerplunkdeveloper-lgtm/backend_api_attendance_.git"
APP_ROOT=/home/ubuntu/workpulse-production-api
RELEASES="$APP_ROOT/.releases"
CURRENT="$APP_ROOT/current"
ENV_FILE=/home/ubuntu/workpulse-prod.env
PM2_NAME=workpulse-production-api
HEALTH_URL=http://127.0.0.1:5000/api/health

[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid commit SHA'; exit 2; }
[[ -f "$ENV_FILE" ]] || { echo 'Production env file missing'; exit 3; }
[[ ! -e "$CURRENT" || -L "$CURRENT" ]] || { echo 'Current release path exists and is not a symlink; refusing migration'; exit 3; }
command -v pg_dump >/dev/null
command -v aws >/dev/null
mkdir -p "$RELEASES" /home/ubuntu/workpulse-prod-backups
aws s3api get-bucket-encryption --bucket "$BACKUP_BUCKET" --region "$REGION" >/dev/null
VERSIONING=$(aws s3api get-bucket-versioning --bucket "$BACKUP_BUCKET" --region "$REGION" --query Status --output text)
[[ "$VERSIONING" == Enabled ]] || { echo 'Backup bucket versioning must be Enabled'; exit 3; }
aws s3api get-public-access-block --bucket "$BACKUP_BUCKET" --region "$REGION" >/dev/null

PREVIOUS=""
if [[ -L "$CURRENT" ]]; then PREVIOUS=$(readlink -f "$CURRENT"); fi
RELEASE="$RELEASES/$SHA"
[[ ! -e "$RELEASE" ]] || { echo 'Release already exists; refusing to overwrite'; exit 4; }

cleanup() { rm -rf "${WORKDIR:-}"; }
trap cleanup EXIT
WORKDIR=$(mktemp -d /tmp/workpulse-backend.XXXXXX)
git clone --quiet --no-checkout "$REPO" "$WORKDIR/source"
git -C "$WORKDIR/source" fetch --quiet --depth=1 origin "$SHA"
git -C "$WORKDIR/source" checkout --quiet --detach FETCH_HEAD
[[ "$(git -C "$WORKDIR/source" rev-parse HEAD)" == "$SHA" ]] || exit 5
mkdir -p "$RELEASE"
tar -C "$WORKDIR/source" --exclude=.git -cf - . | tar -C "$RELEASE" -xf -
ln -s "$ENV_FILE" "$RELEASE/.env"
(cd "$RELEASE" && npm ci --omit=dev && npx prisma generate)

# Load DB settings without printing them. pg_dump reads the password through a
# private pgpass file instead of placing it in command arguments.
set -a
source "$ENV_FILE"
set +a
[[ -n "${DATABASE_URL:-}" ]] || { echo 'DATABASE_URL missing in production env'; exit 6; }
PGPASS="$WORKDIR/pgpass"
export DATABASE_URL PGPASS
python3 - <<'PY'
import os, urllib.parse
u = urllib.parse.urlsplit(os.environ['DATABASE_URL'])
if not u.hostname or not u.username or u.password is None or not u.path.strip('/'):
    raise SystemExit('DATABASE_URL is not a complete PostgreSQL URI')
def esc(s): return s.replace('\\', '\\\\').replace(':', '\\:')
with open(os.environ['PGPASS'], 'w') as f:
    f.write(':'.join(map(esc, [u.hostname, str(u.port or 5432), urllib.parse.unquote(u.path.lstrip('/')), urllib.parse.unquote(u.username), urllib.parse.unquote(u.password)]))+'\n')
os.chmod(os.environ['PGPASS'], 0o600)
PY
export PGPASSFILE="$PGPASS"
DB_HOST=$(python3 -c 'import os,urllib.parse;print(urllib.parse.urlsplit(os.environ["DATABASE_URL"]).hostname)')
DB_PORT=$(python3 -c 'import os,urllib.parse;print(urllib.parse.urlsplit(os.environ["DATABASE_URL"]).port or 5432)')
DB_NAME=$(python3 -c 'import os,urllib.parse;print(urllib.parse.unquote(urllib.parse.urlsplit(os.environ["DATABASE_URL"]).path.lstrip("/")))')
DB_USER=$(python3 -c 'import os,urllib.parse;print(urllib.parse.unquote(urllib.parse.urlsplit(os.environ["DATABASE_URL"]).username))')
export PGHOST="$DB_HOST" PGPORT="$DB_PORT" PGDATABASE="$DB_NAME" PGUSER="$DB_USER"
BACKUP="/home/ubuntu/workpulse-prod-backups/${SHA}-$(date -u +%Y%m%dT%H%M%SZ).dump"
pg_dump --format=custom --file "$BACKUP"
aws s3 cp "$BACKUP" "s3://${BACKUP_BUCKET}/neon/backend/${SHA}/$(basename "$BACKUP")" --region "$REGION" --only-show-errors
aws s3api head-object --bucket "$BACKUP_BUCKET" --key "neon/backend/${SHA}/$(basename "$BACKUP")" --region "$REGION" >/dev/null
pg_restore --list "$BACKUP" >/dev/null
echo "Verified encrypted-backup object for release $SHA"

(cd "$RELEASE" && npm run db:deploy && npm run verify:production)
ln -sfn "$RELEASE" "$CURRENT.next"
mv -Tf "$CURRENT.next" "$CURRENT"

restart_from() {
  local dir="$1"
  pm2 delete "$PM2_NAME" >/dev/null 2>&1 || true
  (set -a; source "$ENV_FILE"; set +a; cd "$dir" && pm2 start npm --name "$PM2_NAME" -- start)
}
SWITCHED=1
rollback_on_error() {
  local rc=$?
  trap - ERR
  if [[ "${SWITCHED:-0}" == 1 ]]; then
    echo 'Deployment step failed; restoring previous application release' >&2
    pm2 delete "$PM2_NAME" >/dev/null 2>&1 || true
    if [[ -n "$PREVIOUS" && -d "$PREVIOUS" ]]; then
      ln -sfn "$PREVIOUS" "$CURRENT.next"; mv -Tf "$CURRENT.next" "$CURRENT"
      restart_from "$PREVIOUS" || true
    else
      rm -f "$CURRENT"
      restart_from "$APP_ROOT" || true
    fi
    pm2 save >/dev/null 2>&1 || true
  fi
  exit "$rc"
}
trap rollback_on_error ERR
restart_from "$RELEASE"
for _ in $(seq 1 30); do
  if curl --fail --silent --show-error "$HEALTH_URL" >/dev/null 2>&1; then
    pm2 save
    find "$RELEASES" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -nr | tail -n +6 | cut -d' ' -f2- | while IFS= read -r old; do [[ "$old" == "$CURRENT" ]] || rm -rf -- "$old"; done
    SWITCHED=0
    trap - ERR
    echo "Backend release $SHA healthy"
    exit 0
  fi
  sleep 2
done

echo 'Backend health check failed; restoring previous application release'
trap - ERR
pm2 delete "$PM2_NAME" >/dev/null 2>&1 || true
if [[ -n "$PREVIOUS" && -d "$PREVIOUS" ]]; then
  ln -sfn "$PREVIOUS" "$CURRENT.next"; mv -Tf "$CURRENT.next" "$CURRENT"
  restart_from "$PREVIOUS"
else
  rm -f "$CURRENT"
  restart_from "$APP_ROOT"
fi
pm2 save
SWITCHED=0
exit 7
