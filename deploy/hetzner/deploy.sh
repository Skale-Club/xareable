#!/usr/bin/env bash

set -Eeuo pipefail

APP_NAME="${APP_NAME:-xareable}"
APP_DIR="${APP_DIR:-/var/www/xareable}"
BRANCH="${BRANCH:-main}"
PORT="${PORT:-5000}"
LOG_ROOT="${LOG_ROOT:-/var/log/xareable}"
DEPLOY_LOG_DIR="${DEPLOY_LOG_DIR:-$LOG_ROOT/deploy}"
APP_LOG_DIR="${APP_LOG_DIR:-$LOG_ROOT/app}"
PM2_CONFIG="${PM2_CONFIG:-$APP_DIR/deploy/hetzner/ecosystem.config.cjs}"
PM2_BIN="${PM2_BIN:-pm2}"
TIMESTAMP="$(date +"%Y%m%d-%H%M%S")"
LOG_FILE="$DEPLOY_LOG_DIR/deploy-$TIMESTAMP.log"

mkdir -p "$DEPLOY_LOG_DIR" "$APP_LOG_DIR"

exec > >(tee -a "$LOG_FILE") 2>&1

on_error() {
  local exit_code=$?
  echo
  echo "[deploy] failed with exit code $exit_code"
  echo "[deploy] full log: $LOG_FILE"
  exit "$exit_code"
}

trap on_error ERR

echo "[deploy] app=$APP_NAME"
echo "[deploy] branch=$BRANCH"
echo "[deploy] app_dir=$APP_DIR"
echo "[deploy] started_at=$(date --iso-8601=seconds)"

if [[ ! -d "$APP_DIR/.git" ]]; then
  echo "[deploy] missing git repository in $APP_DIR"
  exit 1
fi

cd "$APP_DIR"

echo "[deploy] node=$(node --version)"
echo "[deploy] npm=$(npm --version)"

echo "[deploy] fetching latest code"
git fetch --all --prune
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

echo "[deploy] installing dependencies"
npm ci

echo "[deploy] typechecking"
npm run check

echo "[deploy] building production bundle"
npm run build

if ! command -v "$PM2_BIN" >/dev/null 2>&1; then
  echo "[deploy] pm2 not found. Install it first: npm install -g pm2"
  exit 1
fi

echo "[deploy] reloading process with pm2"
"$PM2_BIN" startOrReload "$PM2_CONFIG" --update-env
"$PM2_BIN" save

echo "[deploy] waiting for application warmup"
sleep 3

HEALTH_URL="http://127.0.0.1:$PORT/"
if command -v curl >/dev/null 2>&1; then
  echo "[deploy] checking $HEALTH_URL"
  curl --fail --silent --show-error --max-time 15 "$HEALTH_URL" >/dev/null
fi

ln -sfn "$LOG_FILE" "$DEPLOY_LOG_DIR/latest.log"

echo "[deploy] success"
echo "[deploy] deploy log: $LOG_FILE"
echo "[deploy] app logs: $APP_LOG_DIR"
