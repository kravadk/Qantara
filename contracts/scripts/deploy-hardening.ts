import { ethers } from 'ethers';

export const QIE_MAINNET_CHAIN_ID = 1990n;

export const compilerVerification = {
  solc: '0.8.24',
  optimizer: { enabled: true, runs: 200 },
  evmVersion: 'paris',
};

export function requireQieMainnetRuntime(networkName: string, chainId: bigint) {
  if (networkName !== 'qieMainnet') return;

  if (!process.env.PRIVATE_KEY?.trim()) {
    throw new Error('PRIVATE_KEY must be set for qieMainnet deployments.');
  }
  if (!process.env.QIE_RPC_URL?.trim()) {
    throw new Error('QIE_RPC_URL must be set for qieMainnet deployments.');
  }
  if (chainId !== QIE_MAINNET_CHAIN_ID) {
    throw new Error(`qieMainnet deployment connected to unexpected chainId ${chainId}.`);
  }
}

export function requireConfiguredAddress(name: string): string {
  const value = process.env[name]?.trim() ?? '';
  if (!ethers.isAddress(value)) {
    throw new Error(`${name} must be a configured EVM address.`);
  }
  if (value === ethers.ZeroAddress) {
    throw new Error(`${name} cannot be the zero address.`);
  }
  return ethers.getAddress(value);
}

export function requireManifestAddress(manifest: any, contractName: string): string {
  const value = manifest?.contracts?.[contractName];
  if (!ethers.isAddress(value)) {
    throw new Error(`Deployment manifest is missing ${contractName}.`);
  }
  if (value === ethers.ZeroAddress) {
    throw new Error(`Deployment manifest contains zero address for ${contractName}.`);
  }
  return ethers.getAddress(value);
}

export function requireManifestChain(manifest: any, networkName: string, chainId: bigint, fileName: string) {
  if (manifest?.network !== networkName) {
    throw new Error(`${fileName} network ${manifest?.network} does not match active network ${networkName}.`);
  }
  if (BigInt(manifest?.chainId ?? 0) !== chainId) {
    throw new Error(`${fileName} chainId ${manifest?.chainId} does not match active chainId ${chainId}.`);
  }
}

export function verificationEntry(constructorArgs: string[]) {
  return {
    compiler: compilerVerification,
    constructorArgs,
  };
}
