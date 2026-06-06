import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Users, Plus, Wallet, Send, CheckCircle, XCircle, Loader2, Copy, ExternalLink } from 'lucide-react';
import { useAccount, usePublicClient, useWriteContract } from 'wagmi';
import { formatEther, formatUnits, parseEther, parseUnits, toHex, zeroAddress, type Hex } from 'viem';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { useToastStore } from '../../components/ToastContainer';
import { qantaraMultiPayAbi, erc20ApproveAbi } from '../../lib/qantaraAbi';
import { QANTARA_MULTIPAY_ADDRESS, QUSDC_ADDRESS } from '../../lib/dealRoom';
import { qieMainnet } from '../../config/wagmi';

type Token = 'QIE' | 'QUSDC';
type Status = 0 | 1 | 2;

const STATUS_LABEL = ['Open', 'Settled', 'Cancelled'] as const;

interface InvoiceView {
  merchant: `0x${string}`;
  token: `0x${string}`;
  goal: bigint;
  totalRaised: bigint;
  createdAt: number;
  expiresAt: number;
  metadataHash: Hex;
  status: Status;
}

function tokenSymbol(addr: string): Token {
  return addr === zeroAddress ? 'QIE' : 'QUSDC';
}

function formatAmount(value: bigint, sym: Token): string {
  return sym === 'QIE' ? formatEther(value) : formatUnits(value, 6);
}

export function MultiPay() {
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: qieMainnet.id });
  const { writeContractAsync } = useWriteContract();
  const { addToast } = useToastStore();

  const [mode, setMode] = useState<'create' | 'manage'>('create');
  const [loadedHash, setLoadedHash] = useState<Hex | ''>('');
  const [invoice, setInvoice] = useState<InvoiceView | null>(null);
  const [myContribution, setMyContribution] = useState<bigint>(0n);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [createToken, setCreateToken] = useState<Token>('QIE');
  const [createGoal, setCreateGoal] = useState('');
  const [createExpiresAt, setCreateExpiresAt] = useState('');

  const [contributeAmount, setContributeAmount] = useState('');

  const contractReady = Boolean(QANTARA_MULTIPAY_ADDRESS);

  const loadInvoice = async (hash: Hex) => {
    if (!publicClient) return;
    setIsLoading(true);
    setLoadError(null);
    try {
      const inv = (await (publicClient as any).readContract({
        address: QANTARA_MULTIPAY_ADDRESS!,
        abi: qantaraMultiPayAbi,
        functionName: 'getInvoice',
        args: [hash],
      })) as InvoiceView;
      setInvoice(inv);
      if (address) {
        const c = (await (publicClient as any).readContract({
          address: QANTARA_MULTIPAY_ADDRESS!,
          abi: qantaraMultiPayAbi,
          functionName: 'getContribution',
          args: [hash, address],
        })) as bigint;
        setMyContribution(c);
      } else {
        setMyContribution(0n);
      }
    } catch (err) {
      const message = (err as any)?.shortMessage ?? (err as Error).message;
      addToast('error', `Failed to load invoice: ${message}`);
      setLoadError(message);
      setInvoice(null);
      setMyContribution(0n);
    } finally {
      setIsLoading(false);
    }
  };

  const hashReady = /^0x[a-fA-F0-9]{64}$/.test(loadedHash);

  useEffect(() => {
    if (mode !== 'manage') return;
    if (!loadedHash || !hashReady) {
      setInvoice(null);
      setLoadError(null);
      setMyContribution(0n);
      return;
    }
    void loadInvoice(loadedHash as Hex);
  }, [loadedHash, mode, address, hashReady]);

  const tokenSym = invoice ? tokenSymbol(invoice.token) : createToken;

  const handleCreate = async () => {
    if (!address) return addToast('warning', 'Connect wallet first');
    if (!contractReady) return addToast('error', 'MultiPay contract address not configured');
    if (createGoal && !/^\d+(\.\d+)?$/.test(createGoal)) return addToast('error', 'Invalid goal');
    try {
      const saltBytes = crypto.getRandomValues(new Uint8Array(32));
      const salt = toHex(saltBytes);
      const tokenAddr = createToken === 'QIE' ? zeroAddress : (QUSDC_ADDRESS as `0x${string}`);
      const goalWei = createGoal ? (createToken === 'QIE' ? parseEther(createGoal) : parseUnits(createGoal, 6)) : 0n;
      const expiresAtSec = createExpiresAt ? Math.floor(new Date(createExpiresAt).getTime() / 1000) : 0;

      addToast('info', 'Confirm createInvoice (MultiPay) on mainnet');
      const tx = await writeContractAsync({
        account: address,
        chain: qieMainnet,
        address: QANTARA_MULTIPAY_ADDRESS!,
        abi: qantaraMultiPayAbi,
        functionName: 'createInvoice',
        args: [salt as Hex, tokenAddr, goalWei, BigInt(expiresAtSec), '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex],
      } as any);
      const r = await publicClient!.waitForTransactionReceipt({ hash: tx });
      addToast('success', `Confirmed in block ${r.blockNumber}`);

      const hash = (await (publicClient as any).readContract({
        address: QANTARA_MULTIPAY_ADDRESS!,
        abi: qantaraMultiPayAbi,
        functionName: 'computeInvoiceHash',
        args: [address, salt as Hex],
      })) as Hex;
      setLoadedHash(hash);
      setMode('manage');
      await loadInvoice(hash);
    } catch (err) {
      addToast('error', (err as any)?.shortMessage ?? (err as Error).message);
    }
  };

  const handleContribute = async () => {
    if (!address || !invoice) return;
    if (!contributeAmount || !/^\d+(\.\d+)?$/.test(contributeAmount)) return addToast('error', 'Invalid amount');
    try {
      if (tokenSym === 'QIE') {
        addToast('info', 'Confirm contributeNative');
        const tx = await writeContractAsync({
          account: address,
          chain: qieMainnet,
          address: QANTARA_MULTIPAY_ADDRESS!,
          abi: qantaraMultiPayAbi,
          functionName: 'contributeNative',
          args: [loadedHash as Hex],
          value: parseEther(contributeAmount),
        } as any);
        await publicClient!.waitForTransactionReceipt({ hash: tx });
      } else {
        const amount = parseUnits(contributeAmount, 6);
        const allowance = (await (publicClient as any).readContract({
          address: QUSDC_ADDRESS!,
          abi: erc20ApproveAbi,
          functionName: 'allowance',
          args: [address, QANTARA_MULTIPAY_ADDRESS!],
        })) as bigint;
        if (allowance < amount) {
          addToast('info', 'Step 1/2: approve QUSDC');
          const ap = await writeContractAsync({
            account: address,
            chain: qieMainnet,
            address: QUSDC_ADDRESS!,
            abi: erc20ApproveAbi,
            functionName: 'approve',
            args: [QANTARA_MULTIPAY_ADDRESS!, amount],
          } as any);
          await publicClient!.waitForTransactionReceipt({ hash: ap });
        }
        addToast('info', 'Step 2/2: confirm contributeERC20');
        const tx = await writeContractAsync({
          account: address,
          chain: qieMainnet,
          address: QANTARA_MULTIPAY_ADDRESS!,
          abi: qantaraMultiPayAbi,
          functionName: 'contributeERC20',
          args: [loadedHash as Hex, amount],
        } as any);
        await publicClient!.waitForTransactionReceipt({ hash: tx });
      }
      addToast('success', 'Contribution confirmed');
      setContributeAmount('');
      await loadInvoice(loadedHash as Hex);
    } catch (err) {
      addToast('error', (err as any)?.shortMessage ?? (err as Error).message);
    }
  };

  const runWrite = async (functionName: 'settleInvoice' | 'cancelInvoice' | 'claimRefund', label: string) => {
    if (!address || !invoice) return;
    try {
      addToast('info', `Confirm ${label}`);
      const tx = await writeContractAsync({
        account: address,
        chain: qieMainnet,
        address: QANTARA_MULTIPAY_ADDRESS!,
        abi: qantaraMultiPayAbi,
        functionName,
        args: [loadedHash as Hex],
      } as any);
      await publicClient!.waitForTransactionReceipt({ hash: tx });
      addToast('success', `${label} confirmed`);
      await loadInvoice(loadedHash as Hex);
    } catch (err) {
      addToast('error', (err as any)?.shortMessage ?? (err as Error).message);
    }
  };

  const isMerchant = invoice && address && invoice.merchant.toLowerCase() === address.toLowerCase();
  const goalProgress = useMemo(() => {
    if (!invoice || invoice.goal === 0n) return null;
    return Number((invoice.totalRaised * 1000n) / invoice.goal) / 10;
  }, [invoice]);
  const invoiceExpired = invoice ? invoice.expiresAt > 0 && Date.now() / 1000 > invoice.expiresAt : false;

  const explorerUrl = qieMainnet.blockExplorers.default.url;

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <Users className="w-8 h-8 text-primary" />
          <h1 className="text-4xl font-bold text-white tracking-tight">Collective Invoices</h1>
        </div>
        <p className="text-text-muted">Contract state is read from the multi-pay invoice contract on QIE Mainnet. Writes wait for chain transaction receipts before the page refreshes.</p>
      </div>

      {!contractReady && (
        <Card className="p-4 border border-yellow-500/30 bg-yellow-500/5 text-yellow-300 text-sm">
          VITE_QANTARA_MULTIPAY_ADDRESS is not configured. Set it in your .env to use this page.
        </Card>
      )}

      <div className="flex gap-2 border-b border-border-default">
        <button
          onClick={() => setMode('create')}
          className={`px-4 py-2 text-sm font-bold border-b-2 transition-colors ${mode === 'create' ? 'border-primary text-white' : 'border-transparent text-text-muted hover:text-white'}`}
        >
          <Plus className="inline w-4 h-4 mr-1" /> Create
        </button>
        <button
          onClick={() => setMode('manage')}
          className={`px-4 py-2 text-sm font-bold border-b-2 transition-colors ${mode === 'manage' ? 'border-primary text-white' : 'border-transparent text-text-muted hover:text-white'}`}
        >
          <Wallet className="inline w-4 h-4 mr-1" /> Open / Manage
        </button>
      </div>

      {mode === 'create' && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="p-6 space-y-4">
            <div>
              <label className="text-xs font-bold uppercase tracking-widest text-text-muted">Token</label>
              <div className="flex gap-2 mt-2">
                {(['QIE', 'QUSDC'] as Token[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => setCreateToken(t)}
                    className={`px-4 py-2 text-sm font-bold rounded border ${createToken === t ? 'border-primary bg-primary/10 text-primary' : 'border-border-default text-text-muted hover:text-white'}`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-widest text-text-muted">Goal (optional, blank means no target)</label>
              <input
                type="text"
                inputMode="decimal"
                placeholder="e.g. 5.0"
                value={createGoal}
                onChange={(e) => setCreateGoal(e.target.value)}
                className="w-full mt-2 px-3 py-2 bg-surface-1 border border-border-default rounded text-white"
              />
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-widest text-text-muted">Expires (optional)</label>
              <input
                type="datetime-local"
                value={createExpiresAt}
                onChange={(e) => setCreateExpiresAt(e.target.value)}
                className="w-full mt-2 px-3 py-2 bg-surface-1 border border-border-default rounded text-white"
              />
            </div>
            <Button onClick={handleCreate} disabled={!contractReady || !address} className="w-full">
              <Plus className="w-4 h-4 mr-1" /> Create Collective Invoice
            </Button>
          </Card>
        </motion.div>
      )}

      {mode === 'manage' && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <Card className="p-6 space-y-3">
            <label className="text-xs font-bold uppercase tracking-widest text-text-muted">Invoice hash</label>
            <input
              type="text"
              placeholder="0x... (64 hex)"
              value={loadedHash}
              onChange={(e) => setLoadedHash(e.target.value.trim() as Hex)}
              className="w-full px-3 py-2 bg-surface-1 border border-border-default rounded text-white font-mono text-xs"
            />
            <p className="text-xs text-text-muted">Enter the invoice hash returned by the contract-backed create flow. This view only reads contract state for that hash.</p>
          </Card>

          {loadedHash && !hashReady && (
            <Card className="p-4 border border-yellow-500/30 bg-yellow-500/5 text-yellow-200 text-sm">
              Use a full 32-byte invoice hash in 0x-prefixed hex format.
            </Card>
          )}

          {isLoading && (
            <div className="text-center text-text-muted text-sm py-4">
              <Loader2 className="inline w-4 h-4 mr-2 animate-spin" /> Loading from contract...
            </div>
          )}

          {loadError && !isLoading && (
            <Card className="p-4 border border-red-500/30 bg-red-500/5 text-red-200 text-sm">
              Contract read failed: {loadError}
            </Card>
          )}

          {!loadedHash && !isLoading && (
            <Card className="p-6 text-center text-sm text-text-muted">
              Open an existing collective invoice by entering its contract hash, or create a new one from the Create tab.
            </Card>
          )}

          {invoice && (
            <Card className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-text-muted uppercase tracking-widest">Status</div>
                  <div className={`text-xl font-bold ${invoice.status === 0 ? 'text-primary' : invoice.status === 1 ? 'text-green-400' : 'text-text-muted'}`}>
                    {invoiceExpired && invoice.status === 0 ? 'Expired' : STATUS_LABEL[invoice.status]}
                  </div>
                  <div className="mt-1 text-xs text-text-muted">Source: contract read on QIE Mainnet</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-text-muted uppercase tracking-widest">Total raised</div>
                  <div className="text-2xl font-bold text-white">
                    {formatAmount(invoice.totalRaised, tokenSym)} <span className="text-sm text-text-muted">{tokenSym}</span>
                  </div>
                  {invoice.goal > 0n && (
                    <div className="text-xs text-text-muted">of {formatAmount(invoice.goal, tokenSym)} {tokenSym} {goalProgress != null && `(${goalProgress}%)`}</div>
                  )}
                </div>
              </div>

              <div className="text-xs space-y-1 font-mono">
                <div><span className="text-text-muted">Merchant: </span><a href={`${explorerUrl}/address/${invoice.merchant}`} target="_blank" rel="noreferrer" className="hover:text-primary inline-flex items-center gap-1">{invoice.merchant.slice(0, 10)}...{invoice.merchant.slice(-6)} <ExternalLink className="w-3 h-3" /></a></div>
                <div><span className="text-text-muted">Created: </span>{new Date(invoice.createdAt * 1000).toLocaleString()}</div>
                {invoice.expiresAt > 0 && <div><span className="text-text-muted">Expires: </span>{new Date(invoice.expiresAt * 1000).toLocaleString()}</div>}
                <div className="flex items-center gap-2"><span className="text-text-muted">Hash: </span>{loadedHash.slice(0, 14)}...<button onClick={() => { void navigator.clipboard.writeText(loadedHash); addToast('success', 'Copied'); }} className="text-primary hover:text-white"><Copy className="w-3 h-3" /></button></div>
                <div><span className="text-text-muted">Your contribution: </span>{formatAmount(myContribution, tokenSym)} {tokenSym}</div>
              </div>

              {invoice.status === 0 && !invoiceExpired && (
                <div className="space-y-2 border-t border-border-default pt-4">
                  <label className="text-xs font-bold uppercase tracking-widest text-text-muted">Contribute</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder={`amount ${tokenSym}`}
                      value={contributeAmount}
                      onChange={(e) => setContributeAmount(e.target.value)}
                      className="flex-1 px-3 py-2 bg-surface-1 border border-border-default rounded text-white"
                    />
                    <Button onClick={handleContribute} disabled={!address}>
                      <Send className="w-4 h-4 mr-1" /> Contribute
                    </Button>
                  </div>
                </div>
              )}

              {invoice.status === 0 && invoiceExpired && (
                <div className="rounded border border-yellow-500/30 bg-yellow-500/5 p-3 text-sm text-yellow-200">
                  This invoice is past its contract expiry. Contributions are closed; eligible contributors can claim a refund balance.
                </div>
              )}

              {invoice.status === 0 && isMerchant && (
                <div className="flex gap-2 border-t border-border-default pt-4">
                  <Button onClick={() => runWrite('settleInvoice', 'Settle')} disabled={invoice.totalRaised === 0n} className="flex-1">
                    <CheckCircle className="w-4 h-4 mr-1" /> Settle
                  </Button>
                  <Button variant="secondary" onClick={() => runWrite('cancelInvoice', 'Cancel')} className="flex-1">
                    <XCircle className="w-4 h-4 mr-1" /> Cancel
                  </Button>
                </div>
              )}

              {(invoice.status === 2 || invoiceExpired) && myContribution > 0n && (
                <div className="border-t border-border-default pt-4">
                  <Button onClick={() => runWrite('claimRefund', 'Claim refund')} className="w-full">
                    Claim refund ({formatAmount(myContribution, tokenSym)} {tokenSym})
                  </Button>
                  <p className="text-xs text-text-muted mt-2">Claiming records your refundable balance in the contract. Use <code>withdrawRefund</code> to pull funds to your wallet.</p>
                </div>
              )}
            </Card>
          )}
        </motion.div>
      )}
    </div>
  );
}
