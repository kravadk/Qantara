#!/usr/bin/env bash
# Off-site SQLite backup wrapper. The canonical implementation lives in
# scripts/sqlite-backup.mjs so Windows operators and Linux cron use the same
# snapshot, manifest, and optional upload behavior.
#
# Env:
#   BACKUP_DB        path to the live SQLite db (default: backend/data/qantara.sqlite)
#   BACKUP_OUT       local output dir (default: backups)
#   BACKUP_S3_URI    e.g. s3://bucket/prefix   (requires awscli)
#   BACKUP_GCS_URI   e.g. gs://bucket/prefix   (requires gsutil)
set -euo pipefail

DB="${BACKUP_DB:-backend/data/qantara.sqlite}"
OUT="${BACKUP_OUT:-backups}"
args=(scripts/sqlite-backup.mjs --db "${DB}" --out "${OUT}")

if [ -n "${BACKUP_S3_URI:-}" ]; then
  args+=(--s3-uri "${BACKUP_S3_URI}")
elif [ -n "${BACKUP_GCS_URI:-}" ]; then
  args+=(--gcs-uri "${BACKUP_GCS_URI}")
else
  echo "[backup-to-cloud] no BACKUP_S3_URI / BACKUP_GCS_URI set - local backup only."
fi

echo "[backup-to-cloud] creating snapshot of ${DB}"
node "${args[@]}"
echo "[backup-to-cloud] done."
