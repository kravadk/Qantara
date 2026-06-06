import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function parseEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export function loadE2eEnv(cwd = process.cwd()) {
  const appRoot = resolve(cwd);
  const repoRoot = resolve(appRoot, '..');
  return {
    ...parseEnvFile(resolve(repoRoot, '.env.e2e.local')),
    ...parseEnvFile(resolve(appRoot, '.env.e2e.local')),
    ...process.env,
  };
}
