import { createConfig, http } from 'wagmi';
import { defineChain } from 'viem';
import { injected } from 'wagmi/connectors';

export const qieMainnetRpcUrls = [
  'https://rpc1mainnet.qie.digital',
  'https://rpc2mainnet.qie.digital',
  'https://rpc5mainnet.qie.digital',
  'https://rpc4mainnet.qie.digital',
  'https://rpc3mainnet.qie.digital',
];

export const qieTestnetRpcUrls = [
  'https://rpc1testnet.qie.digital',
  'https://rpc2testnet.qie.digital',
  'https://rpc3testnet.qie.digital',
  'https://rpc4testnet.qie.digital',
  'https://rpc5testnet.qie.digital',
  'https://rpc6testnet.qie.digital',
];

export const qieMainnet = defineChain({
  id: 1990,
  name: 'QIE Mainnet',
  nativeCurrency: { name: 'QIE', symbol: 'QIE', decimals: 18 },
  rpcUrls: { default: { http: qieMainnetRpcUrls } },
  blockExplorers: { default: { name: 'QIE Explorer', url: 'https://mainnet.qie.digital' } },
  testnet: false,
});

export const qieTestnet = defineChain({
  id: 1983,
  name: 'QIE Testnet',
  nativeCurrency: { name: 'QIE', symbol: 'QIE', decimals: 18 },
  rpcUrls: { default: { http: qieTestnetRpcUrls } },
  blockExplorers: { default: { name: 'QIE Testnet Explorer', url: 'https://testnet.qie.digital' } },
  testnet: true,
});

// Legacy aliases so existing pages that import `sepolia`/`arbitrumSepolia` keep working.
export const sepolia = qieMainnet;
export const arbitrumSepolia = qieTestnet;

export const wagmiConfig = createConfig({
  chains: [qieMainnet, qieTestnet],
  connectors: [injected()],
  transports: {
    [qieMainnet.id]: http(qieMainnetRpcUrls[0]),
    [qieTestnet.id]: http(qieTestnetRpcUrls[0]),
  },
});
