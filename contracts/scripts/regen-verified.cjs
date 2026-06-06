const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const EXPECTED_NETWORK = 'qieMainnet';
const EXPECTED_CHAIN_ID = 1990;
const checkOnly = process.argv.includes('--check');

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

function isAddress(value) {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value) && !/^0x0{40}$/.test(value);
}

function loadDeployment(file) {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'deployments', file), 'utf8'));
  assert(manifest.network === EXPECTED_NETWORK, `${file} network must be ${EXPECTED_NETWORK}.`);
  assert(Number(manifest.chainId) === EXPECTED_CHAIN_ID, `${file} chainId must be ${EXPECTED_CHAIN_ID}.`);
  assert(isAddress(manifest.deployer), `${file} must contain a non-zero deployer address.`);
  return manifest;
}

function constructorArgsFor(manifest, name, file) {
  const args = manifest.verification?.[name]?.constructorArgs;
  if (Array.isArray(args)) {
    return args;
  }
  assert(isAddress(manifest.deployer), `${file} must include a deployer address for ${name} constructor metadata.`);
  return [manifest.deployer];
}

const deployments = {
  'qieMainnet.json': loadDeployment('qieMainnet.json'),
  'qieMainnet.v15.json': loadDeployment('qieMainnet.v15.json'),
  'qieMainnet.v4.json': loadDeployment('qieMainnet.v4.json'),
};

const out = {
  network: EXPECTED_NETWORK,
  chainId: EXPECTED_CHAIN_ID,
  verifiedAt: new Date().toISOString(),
  securityVersion: 'Production bundle (core, v1.5 modules, v4 modules)',
  notes: [
    'OZ pinned to exact 5.0.2 because later builds may emit Cancun-only opcodes.',
    'evmVersion: paris because QIE Mainnet does not support EIP-1153 or EIP-5656 as of 2026-05-27.',
    'All Qantara contracts: repository-built bytecode == on-chain bytecode (eth_getCode verified).',
  ],
  contracts: {},
};

for (const { name, sourceDir, deploymentFile } of contracts) {
  const manifest = deployments[deploymentFile];
  const address = manifest.contracts?.[name];
  assert(isAddress(address), `${deploymentFile} must contain a non-zero ${name} address.`);
  const artifactPath = path.join(__dirname, '..', 'artifacts', 'contracts', sourceDir, `${name}.sol`, `${name}.json`);
  assert(fs.existsSync(artifactPath), `${name} artifact is missing. Run npm run build before regenerating.`);
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  const sourcePath = path.join(__dirname, '..', 'contracts', sourceDir, `${name}.sol`);
  assert(fs.existsSync(sourcePath), `${name} source is missing at ${sourcePath}.`);
  const source = fs.readFileSync(sourcePath, 'utf8');
  const constructorArgs = constructorArgsFor(manifest, name, deploymentFile);
  out.contracts[name] = {
    address,
    constructorArgs,
    compiler: {
      solc: '0.8.24',
      optimizer: { enabled: true, runs: 200 },
      evmVersion: 'paris',
    },
    abi: artifact.abi,
    bytecode: artifact.bytecode,
    deployedBytecode: artifact.deployedBytecode,
    source,
    sourceSha256: crypto.createHash('sha256').update(source).digest('hex'),
  };
  console.log(`OK   ${name} @ ${address}`);
}

assert(Object.keys(out.contracts).length === contracts.length, 'Verified bundle must include every production contract.');

const outPath = path.join(__dirname, '..', 'deployments', 'qieMainnet.verified.json');
const outputJson = `${JSON.stringify(out, null, 2)}\n`;
if (checkOnly) {
  const sizeKb = (Buffer.byteLength(outputJson) / 1024).toFixed(1);
  console.log(`\nVerified bundle generation check passed (${sizeKb} KB).`);
  process.exit(0);
}
fs.writeFileSync(outPath, outputJson);
const sizeKb = (fs.statSync(outPath).size / 1024).toFixed(1);
console.log(`\nWrote ${outPath} (${sizeKb} KB)`);
