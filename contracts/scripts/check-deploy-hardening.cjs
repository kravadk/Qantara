const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

function readRepo(relPath) {
  return fs.readFileSync(path.join(root, '..', relPath), 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const deployScripts = ['scripts/deploy.ts', 'scripts/deploy-v15.ts', 'scripts/deploy-v4.ts', 'scripts/deploy-receipt-registry.ts'];
const setupScripts = ['scripts/configure-gas-relay.ts'];
const nonProductionContracts = [
  'QUSDC' + 'TestToken',
  'PermitToken',
  'FeeOnTransferToken',
  'AuthorizationToken',
  'RevertingReceiver',
];

for (const relPath of deployScripts) {
  const source = read(relPath);
  assert(source.includes('requireQieMainnetRuntime'), `${relPath} must run qieMainnet env preflight.`);
  assert(source.includes('verificationEntry'), `${relPath} must write verification constructor metadata.`);
  assert(!source.includes('defaults to https://'), `${relPath} must not document an RPC fallback for deployments.`);
  for (const name of nonProductionContracts) {
    assert(!source.includes(name), `${relPath} must not reference ${name}.`);
  }
}

for (const relPath of setupScripts) {
  const source = read(relPath);
  assert(source.includes('requireQieMainnetRuntime'), `${relPath} must run qieMainnet env preflight.`);
  assert(source.includes('requireManifestAddress'), `${relPath} must validate manifest addresses.`);
  assert(source.includes('requireManifestChain'), `${relPath} must validate manifest chain metadata.`);
}

const hardening = read('scripts/deploy-hardening.ts');
assert(hardening.includes('QIE_MAINNET_CHAIN_ID = 1990n'), 'deploy hardening must pin qieMainnet chainId.');
assert(hardening.includes('ethers.ZeroAddress'), 'deploy hardening must reject zero addresses.');
assert(hardening.includes('QIE_RPC_URL must be set'), 'deploy hardening must require explicit RPC configuration.');

const verifiedCheck = read('scripts/check-verified-manifest.cjs');
assert(verifiedCheck.includes("qieMainnet.verified.json"), 'verified manifest check must validate qieMainnet.verified.json.');
assert(verifiedCheck.includes('sourceSha256'), 'verified manifest check must validate source digests when present.');
assert(verifiedCheck.includes('constructorArgs'), 'verified manifest check must validate constructor metadata when present.');

const regenVerified = read('scripts/regen-verified.cjs');
assert(regenVerified.includes('Verified bundle must include every production contract'), 'verified manifest generation must fail when any contract is missing.');
assert(regenVerified.includes('constructorArgsFor'), 'verified manifest generation must derive constructor metadata.');
assert(!regenVerified.includes('SKIP '), 'verified manifest generation must not skip missing contracts.');

const ignore = read('.gitignore');
for (const required of ['artifacts/', 'cache/', 'typechain-types/', 'deployments/']) {
  assert(ignore.includes(required), `.gitignore must exclude ${required}.`);
}

const ciWorkflow = readRepo('.github/workflows/ci.yml');
assert(ciWorkflow.includes('node --check scripts/check-verified-manifest.cjs'), 'CI must syntax-check the verified manifest validator.');
assert(ciWorkflow.includes('node scripts/regen-verified.cjs --check'), 'CI must validate verified manifest generation inputs.');
assert(ciWorkflow.includes('node scripts/check-verified-manifest.cjs'), 'CI must validate the verified manifest.');

const releaseWorkflow = readRepo('.github/workflows/release.yml');
assert(releaseWorkflow.includes('node scripts/regen-verified.cjs'), 'Release packaging must regenerate the verified manifest.');
assert(releaseWorkflow.includes('node scripts/check-verified-manifest.cjs'), 'Release packaging must validate the verified manifest.');
for (const denied of ['artifacts', 'cache', 'typechain-types', 'coverage', 'node_modules']) {
  assert(releaseWorkflow.includes(denied), `Release bundle validation must reject ${denied}.`);
}

console.log('Deploy hardening checks passed.');
