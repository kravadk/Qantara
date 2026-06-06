#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

function arg(name, fallback) {
  const flag = `--${name}`;
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function quoteSqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, 'Z');
}

const dbPath = resolve(arg('db', process.env.QANTARA_DB_PATH || 'backend/data/qantara.sqlite'));
const outDir = resolve(arg('out', 'backups'));
const outPath = resolve(outDir, `qantara-${timestamp()}.sqlite`);
const s3Uri = arg('s3-uri', process.env.BACKUP_S3_URI || '');
const gcsUri = arg('gcs-uri', process.env.BACKUP_GCS_URI || '');

if (!existsSync(dbPath)) {
  console.error(`SQLite database not found: ${dbPath}`);
  process.exit(1);
}

mkdirSync(dirname(outPath), { recursive: true });

const db = new DatabaseSync(dbPath);
try {
  db.exec('PRAGMA wal_checkpoint(PASSIVE);');
  db.exec(`VACUUM INTO ${quoteSqlString(outPath)};`);
} finally {
  db.close();
}

const bytes = readFileSync(outPath);
const sha256 = createHash('sha256').update(bytes).digest('hex');
const manifest = {
  createdAt: Math.floor(Date.now() / 1000),
  source: dbPath,
  backup: outPath,
  bytes: bytes.length,
  sha256,
  uploadedTo: [],
};
writeFileSync(`${outPath}.json`, `${JSON.stringify(manifest, null, 2)}\n`);

function uploadWithCli(command, args, label) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) {
    console.error(`Backup upload failed for ${label}. Snapshot remains on disk at ${outPath}`);
    process.exit(result.status || 1);
  }
}

function remotePath(uri, filePath) {
  return `${uri.replace(/\/$/, '')}/${filePath.split(/[\\/]/).pop()}`;
}

if (s3Uri && gcsUri) {
  console.error('Set only one remote target: --s3-uri/BACKUP_S3_URI or --gcs-uri/BACKUP_GCS_URI.');
  process.exit(1);
}
if (s3Uri) {
  manifest.uploadedTo.push(s3Uri);
  writeFileSync(`${outPath}.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  uploadWithCli('aws', ['s3', 'cp', outPath, remotePath(s3Uri, outPath)], s3Uri);
  uploadWithCli('aws', ['s3', 'cp', `${outPath}.json`, remotePath(s3Uri, `${outPath}.json`)], s3Uri);
}
if (gcsUri) {
  manifest.uploadedTo.push(gcsUri);
  writeFileSync(`${outPath}.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  uploadWithCli('gsutil', ['cp', outPath, remotePath(gcsUri, outPath)], gcsUri);
  uploadWithCli('gsutil', ['cp', `${outPath}.json`, remotePath(gcsUri, `${outPath}.json`)], gcsUri);
}

writeFileSync(`${outPath}.json`, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify(manifest, null, 2));
