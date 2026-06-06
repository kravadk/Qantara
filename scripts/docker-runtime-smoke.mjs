#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const composeFile = process.env.COMPOSE_FILE || 'docker-compose.production.yml';
const envFile = process.env.QANTARA_ENV_FILE || process.env.ENV_FILE || '.env.production';
const profile = process.env.DOCKER_PROFILE || 'telegram';
const skipBuild = process.env.SKIP_BUILD === 'true';
const skipUp = process.env.SKIP_UP === 'true';
const failures = [];
const checks = [];
const startedAt = new Date().toISOString();
const reportPath = process.env.DOCKER_REPORT_PATH ? resolve(process.env.DOCKER_REPORT_PATH) : undefined;

function record(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  if (!ok) failures.push(`${name}${detail ? `: ${detail}` : ''}`);
}

function writeReport() {
  if (!reportPath) return;
  const failed = checks.filter((check) => !check.ok);
  const report = {
    startedAt,
    finishedAt: new Date().toISOString(),
    status: failed.length > 0 ? 'fail' : 'pass',
    composeFile,
    envFile,
    profile,
    skipBuild,
    skipUp,
    summary: {
      total: checks.length,
      passed: checks.length - failed.length,
      failed: failed.length,
    },
    checks,
  };
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Docker runtime report written: ${reportPath}`);
}

function parseEnv(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index <= 0) continue;
    out[line.slice(0, index).trim()] = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return out;
}

const env = { ...parseEnv(envFile), ...process.env, QANTARA_ENV_FILE: envFile };

function run(name, args, { allowFailure = false } = {}) {
  console.log(`\n$ ${name} ${args.join(' ')}`);
  const result = spawnSync(name, args, {
    stdio: 'inherit',
    env: { ...process.env, QANTARA_ENV_FILE: envFile },
  });
  if (result.status !== 0 && !allowFailure) record(`${name} ${args.join(' ')}`, false, `exited ${result.status}`);
  else record(`${name} ${args.join(' ')}`, true, allowFailure && result.status !== 0 ? `allowed failure ${result.status}` : '');
  return result.status === 0;
}

function runCapture(name, args) {
  const result = spawnSync(name, args, {
    encoding: 'utf8',
    env: { ...process.env, QANTARA_ENV_FILE: envFile },
  });
  return {
    ok: result.status === 0,
    stdout: (result.stdout ?? '').trim(),
    stderr: (result.stderr ?? '').trim(),
    status: result.status,
  };
}

function composeArgs(args) {
  return ['compose', '--profile', profile, '--env-file', envFile, '-f', composeFile, ...args];
}

function composeRun(args, options) {
  return run('docker', composeArgs(args), options);
}

function composeCapture(args) {
  return runCapture('docker', composeArgs(args));
}

function execCheck(service, label, command) {
  const args = composeArgs(['exec', '-T', service, 'sh', '-lc', command]);
  console.log(`\n$ docker ${args.join(' ')}`);
  const result = spawnSync('docker', args, {
    stdio: 'inherit',
    env: { ...process.env, QANTARA_ENV_FILE: envFile },
  });
  if (result.status !== 0) record(`${service} ${label}`, false, `exited ${result.status}`);
  else {
    record(`${service} ${label}`, true);
    console.log(`OK  ${service} ${label}`);
  }
}

function inspectHealth(service) {
  const ps = composeCapture(['ps', '-q', service]);
  if (!ps.ok || !ps.stdout) {
    record(`${service} container id`, false, 'unavailable');
    return;
  }
  const health = runCapture('docker', [
    'inspect',
    '--format',
    '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}',
    ps.stdout.split(/\r?\n/)[0],
  ]);
  if (!health.ok || health.stdout !== 'healthy') {
    record(`${service} docker health`, false, String(health.stdout || health.stderr || health.status));
    return;
  }
  record(`${service} docker health`, true, health.stdout);
  console.log(`OK  ${service} docker health=healthy`);
}

async function poll(name, url, timeoutMs = 90000) {
  const started = Date.now();
  let last = '';
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url);
      last = `HTTP ${res.status}`;
      if (res.ok) {
        record(`${name} HTTP health`, true, `${url} ${last}`);
        console.log(`OK  ${name} ${url} ${last}`);
        return true;
      }
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }
  record(`${name} HTTP health`, false, `${url}: ${last}`);
  return false;
}

function port(name, fallback) {
  return env[name] || fallback;
}

console.log(`Qantara Docker runtime smoke`);
console.log(`compose=${composeFile} env=${envFile} profile=${profile}`);

record('env file exists', existsSync(envFile), envFile);
record('compose file exists', existsSync(composeFile), composeFile);

if (failures.length === 0) {
  run('docker', ['version']);
  composeRun(['config']);
  if (!skipBuild) composeRun(['build']);
  if (!skipUp) composeRun(['up', '-d']);
}

if (failures.length === 0 && !skipUp) {
  await poll('backend', `http://127.0.0.1:${port('BACKEND_PORT', '4000')}/v1/health`);
  await poll('frontend', `http://127.0.0.1:${port('FRONTEND_PORT', '8080')}/`);
  const botPort = Number(port('BOT_WEBHOOK_PORT', '8081'));
  if (profile && Number.isFinite(botPort) && botPort > 0) {
    await poll('telegram bot', `http://127.0.0.1:${botPort}/health`, 60000);
  }
  inspectHealth('backend');
  inspectHealth('frontend');
  if (profile === 'telegram') inspectHealth('tg-bot');

  execCheck('backend', 'runs as non-root user', '[ "$(id -u)" != "0" ]');
  execCheck('backend', 'SQLite data path is writable', 'test -w /app/data && node -e "const fs=require(\'fs\'); const p=\'/app/data/.write-smoke\'; fs.writeFileSync(p, String(Date.now())); fs.unlinkSync(p)"');
  execCheck('frontend', 'runs as non-root user', '[ "$(id -u)" != "0" ]');
  execCheck('frontend', 'nginx configuration is valid', 'nginx -t');
  execCheck('frontend', 'nginx runtime paths are writable', 'test -w /tmp && test -w /var/cache/nginx && test -w /var/run && test -w /var/log/nginx');
  if (profile === 'telegram') {
    execCheck('tg-bot', 'runs as non-root user', '[ "$(id -u)" != "0" ]');
    execCheck('tg-bot', 'application directory is readable', 'test -r /app/index.js');
  }
  composeRun(['ps'], { allowFailure: true });
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`ERR ${failure}`);
  writeReport();
  process.exit(1);
}

console.log('\nOK  docker runtime smoke passed');
writeReport();
