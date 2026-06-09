/**
 * Deploy InstallmentPlan to QIE Mainnet (chain 1990) via a funded deployer wallet.
 *   deployer = TEST_MERCHANT_PK from contracts/.env.e2e (also the contracts owner).
 *
 * Writes deployments/qieMainnet.installment.json and prints the env line.
 * Run: cd contracts && npx ts-node --transpileOnly scripts/deploy-installment-mainnet.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { JsonRpcProvider, Wallet, ContractFactory, getAddress, formatEther } from 'ethers';

dotenv.config({ path: path.join(__dirname, '..', '.env.e2e') });
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const RPC = process.env.QIE_RPC_URL || 'https://rpc1mainnet.qie.digital';
const CHAIN_ID = 1990;

const artifact = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'artifacts', 'contracts', 'InstallmentPlan.sol', 'InstallmentPlan.json'), 'utf8'),
);

async function main() {
  const provider = new JsonRpcProvider(RPC, { chainId: CHAIN_ID, name: 'qie' });
  const pk = process.env.TEST_MERCHANT_PK;
  if (!pk) throw new Error('TEST_MERCHANT_PK missing in contracts/.env.e2e');
  const deployer = new Wallet(pk, provider);

  const bal = await provider.getBalance(deployer.address);
  console.log('='.repeat(64));
  console.log('Deploy InstallmentPlan — QIE Mainnet (chain 1990)');
  console.log('='.repeat(64));
  console.log(`Deployer : ${deployer.address}  bal=${formatEther(bal)} QIE`);
  if (bal === 0n) throw new Error('Deployer has 0 balance');

  const factory = new ContractFactory(artifact.abi, artifact.bytecode, deployer);
  console.log('Deploying...');
  const c = await factory.deploy(deployer.address); // initialOwner
  await c.waitForDeployment();
  const addr = getAddress(await c.getAddress());
  console.log(`Deployed at ${addr}  (tx ${c.deploymentTransaction()?.hash})`);

  const outPath = path.join(__dirname, '..', 'deployments', 'qieMainnet.installment.json');
  fs.writeFileSync(outPath, JSON.stringify({
    network: 'qieMainnet',
    chainId: CHAIN_ID,
    deployer: deployer.address,
    contracts: { InstallmentPlan: addr },
  }, null, 2) + '\n');
  console.log(`Wrote ${outPath}`);
  console.log('-'.repeat(64));
  console.log(`VITE_INSTALLMENT_PLAN_ADDRESS=${addr}`);
  console.log('INSTALLMENT_PLAN_ADDRESS=' + addr + ' (backend, optional)');
}

main().catch((e) => { console.error(e); process.exit(1); });
