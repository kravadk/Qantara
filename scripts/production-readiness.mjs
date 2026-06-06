#!/usr/bin/env node
/**
 * Aggregated production-readiness runner.
 *
 * Base mode runs static guardrails plus environment/live checks when their
 * inputs exist. Full mode also runs package-level release gates.
 *
 *   node scripts/production-readiness.mjs [envFile]
 *
 * Optional checks:
 *   READINESS_FULL=true              -> package lint/test/build gates
 *   READINESS_DOCKER=true            -> scripts/docker-runtime-smoke.mjs
 *   READINESS_MONITORING=true        -> scripts/monitoring-smoke.mjs
 *   READINESS_QIE_NATIVE=true        -> scripts/qie-native-smoke.mjs
 *   READINESS_QUSDC=true             -> scripts/qusdc-smoke.mjs
 *   READINESS_TELEGRAM=true          -> scripts/telegram-smoke.mjs
 *   READINESS_EVIDENCE=true          -> scripts/release-evidence.mjs
 *   BACKEND_URL / QANTARA_BACKEND_URL set -> scripts/staging-smoke.mjs
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const envFile = process.argv[2] || process.env.QANTARA_ENV_FILE || '.env.production';
const steps = [];
const startedAt = new Date().toISOString();
const reportPath = process.env.READINESS_REPORT_PATH
  ? resolve(process.env.READINESS_REPORT_PATH)
  : undefined;

function invocation(name, args) {
  if (name === 'node') return { file: process.execPath, args };
  if (process.platform === 'win32' && (name === 'npm' || name === 'npx')) {
    return {
      file: process.env.ComSpec || 'cmd.exe',
      args: ['/d', '/s', '/c', name, ...args],
    };
  }
  return { file: name, args };
}

function run(
  name,
  cmd,
  args,
  { optional = false, condition = true, skipReason = 'condition not met', cwd = process.cwd(), env = {} } = {},
) {
  if (!condition) {
    steps.push({ name, status: 'skip', reason: skipReason });
    console.log(`\n--- SKIP ${name}: ${skipReason}`);
    return;
  }
  console.log(`\n--- ${name}: ${cmd} ${args.join(' ')}`);
  const next = invocation(cmd, args);
  const result = spawnSync(next.file, next.args, {
    stdio: 'inherit',
    cwd,
    env: { ...process.env, ...env },
  });
  if (result.error) console.error(`Command failed to start: ${result.error.message}`);
  steps.push({
    name,
    status: result.status === 0 ? 'pass' : optional ? 'warn' : 'fail',
    exitCode: result.status,
  });
}

function writeReport() {
  if (!reportPath) return;
  const failed = steps.filter((s) => s.status === 'fail');
  const skipped = steps.filter((s) => s.status === 'skip');
  const warned = steps.filter((s) => s.status === 'warn');
  const report = {
    startedAt,
    finishedAt: new Date().toISOString(),
    envFile,
    full,
    status: failed.length > 0 ? 'fail' : 'pass',
    summary: {
      total: steps.length,
      passed: steps.filter((s) => s.status === 'pass').length,
      failed: failed.length,
      warned: warned.length,
      skipped: skipped.length,
    },
    steps,
  };
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Readiness report written: ${reportPath}`);
}

const full = process.env.READINESS_FULL === 'true';

console.log(`Qantara production readiness - env=${envFile}`);

run('source hygiene guardrails', 'node', ['scripts/production-hygiene.mjs']);

const fullReason = 'set READINESS_FULL=true';

run('backend lint', 'npm', ['run', 'lint'], { condition: full, skipReason: fullReason, cwd: 'backend' });
run('backend tests', 'npm', ['test'], { condition: full, skipReason: fullReason, cwd: 'backend' });
run('backend build', 'npm', ['run', 'build'], { condition: full, skipReason: fullReason, cwd: 'backend' });

run('frontend lint', 'npm', ['run', 'lint'], { condition: full, skipReason: fullReason, cwd: 'qie-app' });
run('frontend tests', 'npm', ['test', '--', '--run'], { condition: full, skipReason: fullReason, cwd: 'qie-app' });
run('frontend build', 'npm', ['run', 'build'], { condition: full, skipReason: fullReason, cwd: 'qie-app' });

run('sdk lint', 'npm', ['run', 'lint'], { condition: full, skipReason: fullReason, cwd: 'packages/qantara-sdk' });
run('sdk tests', 'npm', ['test'], { condition: full, skipReason: fullReason, cwd: 'packages/qantara-sdk' });

run('contracts build', 'npm', ['run', 'build'], { condition: full, skipReason: fullReason, cwd: 'contracts' });
run('contracts tests', 'npm', ['test'], { condition: full, skipReason: fullReason, cwd: 'contracts' });
run('contracts verified manifest', 'node', ['scripts/check-verified-manifest.cjs'], { condition: full, skipReason: fullReason, cwd: 'contracts' });

run('telegram bot syntax', 'node', ['--check', 'index.js'], { condition: full, skipReason: fullReason, cwd: 'tg-bot' });
run('compose template', 'docker', ['compose', '--env-file', '.env.production.example', '-f', 'docker-compose.production.yml', 'config', '--quiet'], {
  condition: full,
  skipReason: fullReason,
  env: { QANTARA_ENV_FILE: '.env.production.example' },
});

run('production preflight', 'node', ['scripts/production-preflight.mjs', envFile], {
  condition: existsSync(envFile),
  skipReason: `${envFile} not found`,
});
run('docker runtime smoke', 'node', ['scripts/docker-runtime-smoke.mjs'], {
  optional: true,
  condition: process.env.READINESS_DOCKER === 'true',
  skipReason: 'set READINESS_DOCKER=true',
});
run('monitoring smoke', 'node', ['scripts/monitoring-smoke.mjs'], {
  optional: true,
  condition: process.env.READINESS_MONITORING === 'true',
  skipReason: 'set READINESS_MONITORING=true',
});
run('native QIE smoke', 'node', ['scripts/qie-native-smoke.mjs'], {
  optional: true,
  condition: process.env.READINESS_QIE_NATIVE === 'true',
  skipReason: 'set READINESS_QIE_NATIVE=true',
});
run('QUSDC smoke', 'node', ['scripts/qusdc-smoke.mjs'], {
  optional: true,
  condition: process.env.READINESS_QUSDC === 'true',
  skipReason: 'set READINESS_QUSDC=true',
});
run('Telegram smoke', 'node', ['scripts/telegram-smoke.mjs'], {
  optional: true,
  condition: process.env.READINESS_TELEGRAM === 'true',
  skipReason: 'set READINESS_TELEGRAM=true',
});
run('staging smoke', 'node', ['scripts/staging-smoke.mjs'], {
  optional: true,
  condition: Boolean(process.env.BACKEND_URL || process.env.QANTARA_BACKEND_URL),
  skipReason: 'set BACKEND_URL or QANTARA_BACKEND_URL',
});
if (process.env.READINESS_EVIDENCE === 'true') writeReport();
run('release evidence bundle', 'node', ['scripts/release-evidence.mjs'], {
  optional: true,
  condition: process.env.READINESS_EVIDENCE === 'true',
  skipReason: 'set READINESS_EVIDENCE=true',
});

console.log('\n================ Readiness scorecard ================');
for (const step of steps) console.log(`  ${step.status.toUpperCase().padEnd(5)} ${step.name}`);

const failed = steps.filter((s) => s.status === 'fail');
const skipped = steps.filter((s) => s.status === 'skip');
if (skipped.length) {
  console.log(`\n${skipped.length} check(s) skipped:`);
  for (const step of skipped) console.log(`  - ${step.name}: ${step.reason}`);
}
if (failed.length > 0) {
  console.error(`\nFAIL - ${failed.length} required check(s) failed.`);
  writeReport();
  process.exit(1);
}
console.log('\nOK - readiness checks passed.');
writeReport();
