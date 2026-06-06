const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const root = path.join(__dirname, '..');
const EXPECTED_NETWORK = 'qieMainnet';
const EXPECTED_CHAIN_ID = 1990;
const EXPECTED_COMPILER = {
  solc: '0.8.24',
  optimizer: { enabled: true, runs: 200 },
  evmVersion: 'paris',
};

const contracts = [
  { name: 'Qantara', sourceDir: '', deploymentFile: 'qieMainnet.json' },
  { name: 'QantaraMultiPay', sourceDir: '', deploymentFile: 'qieMainnet.json' },
  { name: 'MilestoneEscrow', sourceDir: '', deploymentFile: 'qieMainnet.v15.json' },
  { name: 'RecurringScheduler', sourceDir: '', deploymentFile: 'qieMainnet.v15.json' },
  { name: 'BatchPayout', sourceDir: '', deploymentFile: 'qieMainnet.v15.json' },
  { name: 'QantaraChat', sourceDir: 'v4', deploymentFile: 'qieMainnet.v4.json' },
  { name: 'QantaraSplits', sourceDir: 'v4', deploymentFile: 'qieMainnet.v4.json' },
  { name: 'QantaraSubscriptionV2', sourceDir: 'v4', deploymentFile: 'qieMainnet.v4.json' },
  { name: 'QantaraGasRelay', sourceDir: 'v4', deploymentFile: 'qieMainnet.v4.json' },
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function readJson(relPath) {
  return JSON.parse(fs.readFileSync(path.join(root, relPath), 'utf8'));
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isAddress(value) {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value) && !/^0x0{40}$/.test(value);
}

function validateDeployment(file) {
  const manifest = readJson(path.join('deployments', file));
  assert(manifest.network === EXPECTED_NETWORK, `${file} network must be ${EXPECTED_NETWORK}.`);
  assert(Number(manifest.chainId) === EXPECTED_CHAIN_ID, `${file} chainId must be ${EXPECTED_CHAIN_ID}.`);
  assert(isAddress(manifest.deployer), `${file} must contain a non-zero deployer address.`);
  return manifest;
}

function constructorArgsFor(manifest, name) {
  const args = manifest.verification?.[name]?.constructorArgs;
  return Array.isArray(args) ? args : [manifest.deployer];
}

const deployments = {
  'qieMainnet.json': validateDeployment('qieMainnet.json'),
  'qieMainnet.v15.json': validateDeployment('qieMainnet.v15.json'),
  'qieMainnet.v4.json': validateDeployment('qieMainnet.v4.json'),
};

const verified = readJson(path.join('deployments', 'qieMainnet.verified.json'));
assert(verified.network === EXPECTED_NETWORK, 'Verified manifest network must be qieMainnet.');
assert(Number(verified.chainId) === EXPECTED_CHAIN_ID, 'Verified manifest chainId must be 1990.');
assert(verified.contracts && typeof verified.contracts === 'object', 'Verified manifest must contain contracts.');

const expectedNames = contracts.map(({ name }) => name).sort();
const actualNames = Object.keys(verified.contracts).sort();
assert(sameJson(actualNames, expectedNames), `Verified manifest contract set mismatch: ${actualNames.join(', ')}`);

for (const { name, sourceDir, deploymentFile } of contracts) {
  const deployment = deployments[deploymentFile];
  const address = deployment.contracts?.[name];
  const row = verified.contracts[name];
  assert(isAddress(address), `${deploymentFile} must contain a non-zero ${name} address.`);
  assert(row && typeof row === 'object', `Verified manifest missing ${name}.`);
  assert(row.address === address, `${name} verified address must match ${deploymentFile}.`);
  assert(sameJson(row.compiler, EXPECTED_COMPILER), `${name} compiler settings changed.`);

  const artifactPath = path.join(root, 'artifacts', 'contracts', sourceDir, `${name}.sol`, `${name}.json`);
  assert(fs.existsSync(artifactPath), `${name} artifact is missing. Run npm run build before this check.`);
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  assert(sameJson(row.abi, artifact.abi), `${name} ABI does not match the build artifact.`);
  assert(row.bytecode === artifact.bytecode, `${name} init bytecode does not match the build artifact.`);
  assert(row.deployedBytecode === artifact.deployedBytecode, `${name} deployed bytecode does not match the build artifact.`);

  const sourcePath = path.join(root, 'contracts', sourceDir, `${name}.sol`);
  const source = fs.readFileSync(sourcePath, 'utf8');
  const sourceSha256 = crypto.createHash('sha256').update(source).digest('hex');
  assert(row.source === source, `${name} source does not match the repository source.`);
  if (row.sourceSha256 !== undefined) {
    assert(row.sourceSha256 === sourceSha256, `${name} sourceSha256 does not match the source.`);
  }

  const constructorArgs = constructorArgsFor(deployment, name);
  if (row.constructorArgs !== undefined) {
    assert(sameJson(row.constructorArgs, constructorArgs), `${name} constructorArgs do not match ${deploymentFile}.`);
  }
}

console.log('Verified manifest checks passed.');
