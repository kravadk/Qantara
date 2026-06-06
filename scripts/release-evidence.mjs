#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const outputPath = resolve(process.env.RELEASE_EVIDENCE_PATH || 'artifacts/release-evidence.json');
const markdownPath = process.env.RELEASE_EVIDENCE_MARKDOWN_PATH
  ? resolve(process.env.RELEASE_EVIDENCE_MARKDOWN_PATH)
  : undefined;
const requiredGates = new Set(
  (process.env.RELEASE_REQUIRED_GATES || 'readiness')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean),
);

const gateInputs = [
  ['readiness', process.env.READINESS_REPORT_PATH || 'artifacts/production-readiness-report.json'],
  ['docker', process.env.DOCKER_REPORT_PATH || 'artifacts/docker-runtime-smoke-report.json'],
  ['staging', process.env.STAGING_REPORT_PATH || 'artifacts/staging-smoke-report.json'],
  ['monitoring', process.env.MONITORING_REPORT_PATH || 'artifacts/monitoring-smoke-report.json'],
  ['qie-native', process.env.QIE_NATIVE_REPORT_PATH || 'artifacts/qie-native-smoke-report.json'],
  ['qusdc', process.env.QUSDC_REPORT_PATH || 'artifacts/qusdc-smoke-report.json'],
  ['telegram', process.env.TELEGRAM_REPORT_PATH || 'artifacts/telegram-smoke-report.json'],
];

const secretKeyPattern = /(^|[_-])(secret|private[_-]?key|password|access[_-]?token|refresh[_-]?token|auth[_-]?token|bot[_-]?token|api[_-]?key|authorization|signature|mnemonic|bearer|cookie|jwt)([_-]|$)/i;
const longSecretLikePattern = /^[A-Za-z0-9+/=_-]{40,}$/;

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function redact(value, key = '') {
  if (secretKeyPattern.test(key)) return '[redacted]';
  if (Array.isArray(value)) return value.map((item) => redact(item, key));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, redact(childValue, childKey)]));
  }
  if (typeof value === 'string' && longSecretLikePattern.test(value) && !/^0x[a-fA-F0-9]{40,64}$/.test(value)) {
    return '[redacted]';
  }
  return value;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function normalizeCheck(check) {
  if (typeof check?.ok === 'boolean') return check.ok;
  if (typeof check?.status === 'string') return check.status === 'pass' || check.status === 'skip';
  return true;
}

function summarizeGate(name, reportPath) {
  const absolutePath = resolve(reportPath);
  if (!existsSync(absolutePath)) {
    return {
      name,
      status: requiredGates.has(name) ? 'missing' : 'skip',
      required: requiredGates.has(name),
      reportPath,
      detail: 'report not found',
    };
  }

  const raw = readJson(absolutePath);
  const checks = Array.isArray(raw.checks) ? raw.checks : Array.isArray(raw.steps) ? raw.steps : [];
  const failedChecks = checks.filter((check) => !normalizeCheck(check));
  const warnedChecks = checks.filter((check) => check?.status === 'warn');
  const skippedChecks = checks.filter((check) => check?.status === 'skip');
  const explicitStatus = typeof raw.status === 'string' ? raw.status.toLowerCase() : undefined;
  const status = explicitStatus === 'fail' || failedChecks.length > 0
    ? 'fail'
    : explicitStatus === 'missing'
      ? 'missing'
      : 'pass';

  return {
    name,
    status,
    required: requiredGates.has(name),
    reportPath,
    sha256: sha256(absolutePath),
    startedAt: raw.startedAt,
    finishedAt: raw.finishedAt,
    summary: {
      total: checks.length,
      failed: failedChecks.length,
      warned: warnedChecks.length,
      skipped: skippedChecks.length,
    },
    checks: redact(checks),
    artifacts: redact(raw.artifacts || {}),
  };
}

function writeMarkdown(report) {
  if (!markdownPath) return;
  const rows = report.gates.map((gate) => (
    `| ${gate.name} | ${gate.required ? 'yes' : 'no'} | ${gate.status} | ${gate.summary?.total ?? 0} | ${gate.summary?.failed ?? 0} |`
  ));
  const lines = [
    '# Qantara Release Evidence',
    '',
    `Generated: ${report.generatedAt}`,
    `Status: ${report.status}`,
    '',
    '| Gate | Required | Status | Checks | Failed |',
    '| --- | --- | --- | ---: | ---: |',
    ...rows,
    '',
    'Required gates:',
    '',
    ...report.requiredGates.map((gate) => `- ${gate}`),
    '',
    'This artifact contains redacted operational evidence only. Private keys, bearer tokens, signatures, cookies, and API keys must not be stored in release bundles.',
  ];
  mkdirSync(dirname(markdownPath), { recursive: true });
  writeFileSync(markdownPath, `${lines.join('\n')}\n`);
  console.log(`Release evidence markdown written: ${markdownPath}`);
}

const gates = gateInputs.map(([name, path]) => summarizeGate(name, path));
const failedRequired = gates.filter((gate) => gate.required && gate.status !== 'pass');
const report = {
  generatedAt: new Date().toISOString(),
  status: failedRequired.length > 0 ? 'fail' : 'pass',
  requiredGates: [...requiredGates],
  gates,
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Release evidence written: ${outputPath}`);
writeMarkdown(report);

for (const gate of gates) {
  console.log(`${gate.status.toUpperCase().padEnd(7)} ${gate.required ? 'required' : 'optional'} ${gate.name}`);
}

if (failedRequired.length > 0) {
  console.error(`\nRelease evidence failed: ${failedRequired.map((gate) => gate.name).join(', ')}`);
  process.exit(1);
}

console.log('\nOK - release evidence requirements satisfied.');
