#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

function arg(name, fallback) {
  const flag = `--${name}`;
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, 'Z');
}

const backupPath = resolve(arg('from', ''));
const dbPath = resolve(arg('db', process.env.QANTARA_DB_PATH || 'backend/data/qantara.sqlite'));
const preRestoreDir = resolve(arg('pre-restore-out', 'backups'));

if (!hasFlag('yes')) {
  console.error('Refusing to restore without --yes. Stop the backend first, then rerun with --yes.');
  process.exit(1);
}
if (!backupPath || !existsSync(backupPath)) {
  console.error(`Backup file not found: ${backupPath || '(missing --from)'}`);
  process.exit(1);
}

mkdirSync(dirname(dbPath), { recursive: true });
mkdirSync(preRestoreDir, { recursive: true });

if (existsSync(dbPath)) {
  const preRestorePath = resolve(preRestoreDir, `pre-restore-${timestamp()}.sqlite`);
  copyFileSync(dbPath, preRestorePath);
  writeFileSync(`${preRestorePath}.json`, `${JSON.stringify({
    createdAt: Math.floor(Date.now() / 1000),
    source: dbPath,
    backup: preRestorePath,
    reason: 'automatic pre-restore snapshot',
  }, null, 2)}\n`);
}

copyFileSync(backupPath, dbPath);
for (const suffix of ['-wal', '-shm']) {
  const sidecar = `${dbPath}${suffix}`;
  if (existsSync(sidecar)) rmSync(sidecar, { force: true });
}

console.log(JSON.stringify({
  restoredAt: Math.floor(Date.now() / 1000),
  restoredFrom: backupPath,
  target: dbPath,
}, null, 2));
