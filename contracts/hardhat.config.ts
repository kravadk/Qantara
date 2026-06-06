import { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';
import 'solidity-coverage';
import * as dotenv from 'dotenv';

dotenv.config();

const PRIVATE_KEY = process.env.PRIVATE_KEY;
const QIE_RPC_URL = process.env.QIE_RPC_URL ?? 'https://rpc1mainnet.qie.digital';

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.24',
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: false,
      evmVersion: 'paris', // QIE Mainnet does not yet support EIP-1153 (cancun)
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    qieMainnet: {
      url: QIE_RPC_URL,
      chainId: 1990,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },
  },
  paths: {
    sources: './contracts',
    tests: './test',
    cache: './cache',
    artifacts: './artifacts',
  },
};

export default config;
