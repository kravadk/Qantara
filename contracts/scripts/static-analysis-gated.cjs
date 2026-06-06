#!/usr/bin/env node
const { spawnSync } = require('node:child_process');

const enabled = process.env.RUN_CONTRACT_STATIC_ANALYSIS === 'true';
if (!enabled) {
  console.log('contract static analysis skipped: set RUN_CONTRACT_STATIC_ANALYSIS=true to run slither/solhint');
  process.exit(0);
}

function run(name, command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.error) {
    console.error(`${name} failed to start: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`${name} failed with exit code ${result.status}`);
    process.exit(result.status ?? 1);
  }
}

run('hardhat compile', 'npx', ['hardhat', 'compile']);
run('solhint', 'npx', ['solhint', 'contracts/**/*.sol']);
run('slither', 'slither', ['.']);

console.log('contract static analysis completed');
