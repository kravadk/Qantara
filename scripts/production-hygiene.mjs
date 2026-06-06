#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const root = process.cwd();

const docsAndGuardrails = [
  'SECURITY.md',
  'OPERATIONS_RUNBOOK.md',
  'DEPLOYMENT.md',
  'RELEASE.md',
  'README.md',
  'PLAN.md',
  'IMPLEMENTATION_PLAN.md',
  '.github/workflows/ci.yml',
  '.github/workflows/publish.yml',
  '.github/workflows/release.yml',
  'scripts/production-hygiene.mjs',
  'scripts/sqlite-backup.mjs',
  'scripts/sqlite-restore.mjs',
];

const runtimeRoots = [
  'backend/src',
  'qie-app/src',
  'tg-bot',
  'packages/qantara-sdk/src',
  'scripts',
];

const skipSegments = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  'artifacts',
  'cache',
  'typechain-types',
  '.git',
]);

function parts(...value) {
  return value.join('');
}

const blockedDocTerms = [
  parts('fa', 'ke'),
  parts('mo', 'ck'),
  parts('st', 'ub'),
  parts('lo', 'cal'),
  parts('de', 'mo-pa', 'id'),
  parts('hack', 'athon'),
  parts('ju', 'dge'),
  parts('show', 'case'),
];

const runtimePatterns = [
  {
    id: 'seeded-paid-state',
    pattern: new RegExp(`${parts('sample')}\\s+pa${parts('id')}|${parts('de', 'mo')}\\s+pa${parts('id')}|seeded\\s+pa${parts('id')}`, 'i'),
  },
  {
    id: 'unverified-payment-authority',
    pattern: /unverified\s+paid\s+state|client-created\s+tx\s+hash|ephemeral\s+payment\s+override/i,
  },
  {
    id: 'runtime-test-payment-path',
    pattern: new RegExp(`${parts('fa', 'ke')}\\s*tx|qantara${parts('st', 'ub')}|saved\\s+${parts('lo', 'cally')}`, 'i'),
  },
  {
    id: 'api-key-query-leakage',
    pattern: /[?&](?:api_key|api-key|API_KEY|qantara_api_key|qantara-api-key|QANTARA_API_KEY|authorization|Authorization)=|searchParams\.(?:set|append)\(\s*['"`](?:api_key|api-key|API_KEY|qantara_api_key|qantara-api-key|QANTARA_API_KEY|authorization|Authorization)['"`]|URLSearchParams\(\s*\{\s*(?:api_key|API_KEY|qantara_api_key|QANTARA_API_KEY|authorization|Authorization)\s*:/,
  },
  {
    id: 'production-secret-placeholder',
    pattern: /(?:API_KEY|QANTARA_API_KEY|WEBHOOK_SECRET|PAYMENT_INTENT_SECRET|SIWE_JWT_SECRET|PRIVATE_KEY)\s*[:=]\s*['"`]?(?:change[_-]?me|password|secret|123456|test[_-]?key|dev[_-]?key)\b/i,
  },
];

const releaseRequiredFragments = [
  String.raw`(^|/)\.env$`,
  String.raw`(^|/)\.env\.(production|staging|dev)$`,
  'node_modules',
  'artifacts',
  'cache',
  'typechain-types',
  'coverage',
  String.raw`\.sqlite`,
  String.raw`\.sqlite(\.json)?`,
  'pre-restore',
  'backups',
];

function toPosix(path) {
  return path.split(sep).join('/');
}

function existing(paths) {
  return paths.map((path) => resolve(root, path)).filter((path) => existsSync(path));
}

function walk(startPath) {
  if (!existsSync(startPath)) return [];
  const stats = statSync(startPath);
  if (stats.isFile()) return [startPath];
  if (!stats.isDirectory()) return [];

  const segment = startPath.split(/[\\/]/).pop();
  if (skipSegments.has(segment)) return [];

  const files = [];
  for (const entry of readdirSync(startPath, { withFileTypes: true })) {
    const path = join(startPath, entry.name);
    if (entry.isDirectory()) {
      if (!skipSegments.has(entry.name)) files.push(...walk(path));
      continue;
    }
    if (entry.isFile()) files.push(path);
  }
  return files;
}

function textFiles(paths) {
  return paths
    .flatMap((path) => walk(path))
    .filter((path) => /\.(cjs|css|html|js|json|jsx|md|mjs|ts|tsx|txt|yml|yaml)$/.test(path));
}

function read(path) {
  return readFileSync(path, 'utf8');
}

function lineFor(content, index) {
  return content.slice(0, index).split(/\r?\n/).length;
}

const failures = [];

for (const path of existing(docsAndGuardrails)) {
  const content = read(path);
  const lower = content.toLowerCase();
  for (const term of blockedDocTerms) {
    const index = lower.indexOf(term);
    if (index >= 0) {
      failures.push({
        id: 'operator-doc-marker',
        file: toPosix(relative(root, path)),
        line: lineFor(content, index),
        detail: `forbidden operator-doc marker "${term}"`,
      });
    }
  }
}

const runtimeFiles = textFiles(existing(runtimeRoots)).filter((path) => {
  const normalized = toPosix(relative(root, path));
  return !/(^|\/)(.*\.)?(test|spec)\.[cm]?[jt]sx?$/.test(normalized)
    && !normalized.includes('/__tests__/')
    && !normalized.endsWith('.snap');
});

for (const path of runtimeFiles) {
  const content = read(path);
  for (const check of runtimePatterns) {
    const match = check.pattern.exec(content);
    if (match) {
      failures.push({
        id: check.id,
        file: toPosix(relative(root, path)),
        line: lineFor(content, match.index),
        detail: match[0],
      });
    }
  }
}

const releasePath = resolve(root, '.github/workflows/release.yml');
if (existsSync(releasePath)) {
  const content = read(releasePath);
  for (const fragment of releaseRequiredFragments) {
    if (!content.includes(fragment)) {
      failures.push({
        id: 'release-exclusion',
        file: '.github/workflows/release.yml',
        line: 1,
        detail: `missing release validation fragment: ${fragment}`,
      });
    }
  }
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`${failure.file}:${failure.line}: ${failure.id}: ${failure.detail}`);
  }
  process.exit(1);
}

console.log('OK - production hygiene guardrails passed.');
