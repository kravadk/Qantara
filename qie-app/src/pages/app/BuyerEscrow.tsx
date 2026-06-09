import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ShieldCheck, Plus, Wallet, CheckCircle, XCircle, Loader2, Copy, ExternalLink, Clock } from 'lucide-react';
import { useAccount, usePublicClient, useWriteContract } from 'wagmi';
import { formatEther, formatUnits, parseEther, parseUnits, toHex, zeroAddress, isAddress, type Hex } from 'viem';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { useToastStore } from '../../components/ToastContainer';
import { buyerEscrowAbi, erc20ApproveAbi } from '../../lib/qantaraAbi';
import { BUYER_ESCROW_ADDRESS, QUSDC_ADDRESS } from '../../lib/dealRoom';
import { qieMainnet } from '../../config/wagmi';

type Token = 'QIE' | 'QUSDC';
type Status = 0 | 1 | 2;
const STATUS_LABEL = ['Funded (held)', 'Released', 'Refunded'] as const;

interface DealView {
  payer: `0x${string}`;
  merchant: `0x${string}`;
  token: `0x${string}`;
  arbiter: `0x${string}`;
  amount: bigint;
  fundedAt: number;
  autoReleaseAt: number;
  status: Status;
}

const tokenSymbol = (a: string): Token => (a.toLowerCase() === zeroAddress ? 'QIE' : 'QUSDC');
const fmt = (v: bigint, s: Token) => (s === 'QIE' ? formatEther(v) : formatUnits(v, 6));
const toWei = (a: string, s: Token) => (s === 'QIE' ? parseEther(a) : parseUnits(a, 6));

export function BuyerEscrow() {
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: qieMainnet.id });
  const { writeContractAsync } = useWriteContract();
  const { addToast } = useToastStore();

  const [mode, setMode] = useState<'create' | 'manage'>('create');
  const [loadedId, setLoadedId] = useState<Hex | ''>('');
  const [deal, setDeal] = useState<DealView | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const [cMerchant, setCMerchant] = useState('');
  const [cArbiter, setCArbiter] = useState('');
  const [cToken, setCToken] = useState<Token>('QIE');
  const [cAmount, setCAmount] = useState('');
  const [cDays, setCDays] = useState('7');

  const ready = Boolean(BUYER_ESCROW_ADDRESS);
  const ADDR = BUYER_ESCROW_ADDRESS as `0x${string}`;

  const load = async (id: Hex) => {
    if (!publicClient) return;
    setIsLoading(true);
    try {
      const d = (await (publicClient as any).readContract({ address: ADDR, abi: buyerEscrowAbi, functionName: 'getDeal', args: [id] })) as DealView;
      setDeal(d);
    } catch (err) {
      addToast('error', `Failed to load: ${(err as any)?.shortMessage ?? (err as Error).message}`);
      setDeal(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (mode !== 'manage') return;
    if (!loadedId || !/^0x[a-fA-F0-9]{64}$/.test(loadedId)) return;
    void load(loadedId as Hex);
  }, [loadedId, mode, address]);

  const sym = deal ? tokenSymbol(deal.token) : cToken;

  const handleCreate = async () => {
    if (!address) return addToast('warning', 'Connect wallet first');
    if (!ready) return addToast('error', 'BuyerEscrow address not configured');
    if (!isAddress(cMerchant)) return addToast('error', 'Invalid merchant address');
    if (cArbiter && !isAddress(cArbiter)) return addToast('error', 'Invalid arbiter address');
    if (!cAmount || !/^\d+(\.\d+)?$/.test(cAmount)) return addToast('error', 'Invalid amount');
    const days = parseInt(cDays, 10);
    if (!Number.isFinite(days) || days < 0) return addToast('error', 'Auto-release days must be ≥ 0');

    setBusy(true);
    try {
      const salt = toHex(crypto.getRandomValues(new Uint8Array(32)));
      const tokenAddr = cToken === 'QIE' ? zeroAddress : (QUSDC_ADDRESS as `0x${string}`);
      if (cToken === 'QUSDC' && !QUSDC_ADDRESS) { addToast('error', 'QUSDC not configured'); return; }
      const arbiterAddr = (cArbiter ? cArbiter : zeroAddress) as `0x${string}`;
      const amt = toWei(cAmount, cToken);
      const autoSecs = BigInt(days * 86400);

      if (cToken === 'QUSDC') {
        const allowance = (await (publicClient as any).readContract({ address: QUSDC_ADDRESS!, abi: erc20ApproveAbi, functionName: 'allowance', args: [address, ADDR] })) as bigint;
        if (allowance < amt) {
          addToast('info', 'Step 1/2: approve QUSDC');
          const ap = await writeContractAsync({ account: address, chain: qieMainnet, address: QUSDC_ADDRESS!, abi: erc20ApproveAbi, functionName: 'approve', args: [ADDR, amt] } as any);
          await publicClient!.waitForTransactionReceipt({ hash: ap });
        }
      }
      addToast('info', cToken === 'QIE' ? 'Confirm: fund escrow' : 'Step 2/2: fund escrow');
      const tx = await writeContractAsync({
        account: address, chain: qieMainnet, address: ADDR, abi: buyerEscrowAbi,
        functionName: 'createEscrow',
        args: [cMerchant as `0x${string}`, tokenAddr, arbiterAddr, amt, autoSecs, salt],
        value: cToken === 'QIE' ? amt : 0n,
      } as any);
      const r = await publicClient!.waitForTransactionReceipt({ hash: tx });
      addToast('success', `Escrow funded in block ${r.blockNumber}`);
      const id = (await (publicClient as any).readContract({ address: ADDR, abi: buyerEscrowAbi, functionName: 'computeDealId', args: [address, cMerchant as `0x${string}`, salt] })) as Hex;
      setLoadedId(id);
      setMode('manage');
      await load(id);
    } catch (err) {
      addToast('error', (err as any)?.shortMessage ?? (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const runWrite = async (functionName: 'confirmRelease' | 'claimAfterTimeout' | 'refund', label: string) => {
    if (!address || !deal) return;
    setBusy(true);
    try {
      addToast('info', `Confirm ${label}`);
      const tx = await writeContractAsync({ account: address, chain: qieMainnet, address: ADDR, abi: buyerEscrowAbi, functionName, args: [loadedId as Hex] } as any);
      await publicClient!.waitForTransactionReceipt({ hash: tx });
      addToast('success', `${label} confirmed`);
      await load(loadedId as Hex);
    } catch (err) {
      addToast('error', (err as any)?.shortMessage ?? (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const isPayer = deal && address && deal.payer.toLowerCase() === address.toLowerCase();
  const isMerchant = deal && address && deal.merchant.toLowerCase() === address.toLowerCase();
  const isArbiter = deal && address && deal.arbiter !== zeroAddress && deal.arbiter.toLowerCase() === address.toLowerCase();
  const nowSec = Math.floor(Date.now() / 1000);
  const timeoutPassed = deal && deal.autoReleaseAt > 0 && nowSec >= deal.autoReleaseAt;
  const explorerUrl = qieMainnet.blockExplorers.default.url;

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <ShieldCheck className="w-8 h-8 text-primary" />
          <h1 className="text-4xl font-bold text-white tracking-tight">Buyer Escrow</h1>
        </div>
        <p className="text-text-muted">Buyer funds upfront; the contract holds it. The merchant is paid only when the buyer confirms release — buyer protection. If the buyer disappears, the merchant can claim after an auto-release timeout. An optional arbiter can release or refund.</p>
      </div>

      {!ready && (
        <Card className="p-4 border border-yellow-500/30 bg-yellow-500/5 text-yellow-300 text-sm">VITE_BUYER_ESCROW_ADDRESS is not configured.</Card>
      )}

      <div className="flex gap-2 border-b border-border-default">
        <button onClick={() => setMode('create')} className={`px-4 py-2 text-sm font-bold border-b-2 transition-colors ${mode === 'create' ? 'border-primary text-white' : 'border-transparent text-text-muted hover:text-white'}`}>
          <Plus className="inline w-4 h-4 mr-1" /> Create
        </button>
        <button onClick={() => setMode('manage')} className={`px-4 py-2 text-sm font-bold border-b-2 transition-colors ${mode === 'manage' ? 'border-primary text-white' : 'border-transparent text-text-muted hover:text-white'}`}>
          <Wallet className="inline w-4 h-4 mr-1" /> Open / Manage
        </button>
      </div>

      {mode === 'create' && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="p-6 space-y-4">
            <div>
              <label className="text-xs font-bold uppercase tracking-widest text-text-muted">Merchant address</label>
              <input type="text" placeholder="0x…" value={cMerchant} onChange={(e) => setCMerchant(e.target.value.trim())} className="w-full mt-2 px-3 py-2 bg-surface-1 border border-border-default rounded text-white font-mono text-xs" />
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-widest text-text-muted">Arbiter (optional)</label>
              <input type="text" placeholder="0x… or empty" value={cArbiter} onChange={(e) => setCArbiter(e.target.value.trim())} className="w-full mt-2 px-3 py-2 bg-surface-1 border border-border-default rounded text-white font-mono text-xs" />
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-widest text-text-muted">Token</label>
              <div className="flex gap-2 mt-2">
                {(['QIE', 'QUSDC'] as Token[]).map((t) => (
                  <button key={t} onClick={() => setCToken(t)} className={`px-4 py-2 text-sm font-bold rounded border ${cToken === t ? 'border-primary bg-primary/10 text-primary' : 'border-border-default text-text-muted hover:text-white'}`}>{t}</button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-bold uppercase tracking-widest text-text-muted">Amount</label>
                <input type="text" inputMode="decimal" placeholder={`0.0 ${cToken}`} value={cAmount} onChange={(e) => setCAmount(e.target.value)} className="w-full mt-2 px-3 py-2 bg-surface-1 border border-border-default rounded text-white" />
              </div>
              <div>
                <label className="text-xs font-bold uppercase tracking-widest text-text-muted">Auto-release (days, 0 = never)</label>
                <input type="number" min={0} value={cDays} onChange={(e) => setCDays(e.target.value)} className="w-full mt-2 px-3 py-2 bg-surface-1 border border-border-default rounded text-white" />
              </div>
            </div>
            <Button onClick={handleCreate} loading={busy} disabled={!ready || !address} className="w-full">
              <Plus className="w-4 h-4 mr-1" /> Fund Escrow
            </Button>
          </Card>
        </motion.div>
      )}

      {mode === 'manage' && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <Card className="p-6 space-y-3">
            <label className="text-xs font-bold uppercase tracking-widest text-text-muted">Deal id</label>
            <input type="text" placeholder="0x… (64 hex)" value={loadedId} onChange={(e) => setLoadedId(e.target.value.trim() as Hex)} className="w-full px-3 py-2 bg-surface-1 border border-border-default rounded text-white font-mono text-xs" />
          </Card>

          {isLoading && <div className="text-center text-text-muted text-sm py-4"><Loader2 className="inline w-4 h-4 mr-2 animate-spin" /> Loading…</div>}

          {deal && (
            <Card className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-text-muted uppercase tracking-widest">Status</div>
                  <div className={`text-xl font-bold ${deal.status === 0 ? 'text-primary' : deal.status === 1 ? 'text-green-400' : 'text-text-muted'}`}>{STATUS_LABEL[deal.status]}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-text-muted uppercase tracking-widest">Amount</div>
                  <div className="text-2xl font-bold text-white tabular-nums">{fmt(deal.amount, sym)} <span className="text-sm text-text-muted">{sym}</span></div>
                </div>
              </div>

              <div className="text-xs space-y-1 font-mono">
                <div><span className="text-text-muted">Buyer: </span><a href={`${explorerUrl}/address/${deal.payer}`} target="_blank" rel="noreferrer" className="hover:text-primary inline-flex items-center gap-1">{deal.payer.slice(0, 10)}…{deal.payer.slice(-6)} <ExternalLink className="w-3 h-3" /></a></div>
                <div><span className="text-text-muted">Merchant: </span><a href={`${explorerUrl}/address/${deal.merchant}`} target="_blank" rel="noreferrer" className="hover:text-primary inline-flex items-center gap-1">{deal.merchant.slice(0, 10)}…{deal.merchant.slice(-6)} <ExternalLink className="w-3 h-3" /></a></div>
                {deal.arbiter !== zeroAddress && <div><span className="text-text-muted">Arbiter: </span>{deal.arbiter.slice(0, 10)}…{deal.arbiter.slice(-6)}</div>}
                <div className="flex items-center gap-1 text-text-muted"><Clock className="w-3 h-3" /> {deal.autoReleaseAt === 0 ? 'no auto-release' : `auto-release ${timeoutPassed ? 'available' : `at ${new Date(deal.autoReleaseAt * 1000).toLocaleString()}`}`}</div>
                <div className="flex items-center gap-2"><span className="text-text-muted">Id: </span>{(loadedId as string).slice(0, 14)}…<button onClick={() => { void navigator.clipboard.writeText(loadedId); addToast('success', 'Copied'); }} className="text-primary hover:text-white"><Copy className="w-3 h-3" /></button></div>
              </div>

              {deal.status === 0 && (isPayer || isArbiter) && (
                <div className="border-t border-border-default pt-4">
                  <Button onClick={() => runWrite('confirmRelease', 'Release to merchant')} loading={busy} className="w-full">
                    <CheckCircle className="w-4 h-4 mr-1" /> Release {fmt(deal.amount, sym)} {sym} to merchant
                  </Button>
                  <p className="text-xs text-text-muted mt-2">{isPayer ? 'You are the buyer — release when satisfied.' : 'You are the arbiter.'}</p>
                </div>
              )}

              {deal.status === 0 && isMerchant && (
                <div className="border-t border-border-default pt-4">
                  <Button onClick={() => runWrite('claimAfterTimeout', 'Claim after timeout')} loading={busy} disabled={!timeoutPassed} className="w-full">
                    <Clock className="w-4 h-4 mr-1" /> {timeoutPassed ? 'Claim (buyer did not respond)' : 'Claim available after timeout'}
                  </Button>
                </div>
              )}

              {deal.status === 0 && (isMerchant || isArbiter) && (
                <div className="border-t border-border-default pt-4">
                  <Button variant="secondary" onClick={() => runWrite('refund', 'Refund buyer')} loading={busy} className="w-full">
                    <XCircle className="w-4 h-4 mr-1" /> Refund buyer ({fmt(deal.amount, sym)} {sym})
                  </Button>
                </div>
              )}

              {deal.status === 1 && <div className="border-t border-border-default pt-4 text-center text-sm text-green-400"><CheckCircle className="inline w-4 h-4 mr-1" /> Released to merchant.</div>}
              {deal.status === 2 && <div className="border-t border-border-default pt-4 text-center text-sm text-text-muted">Refunded to buyer.</div>}
            </Card>
          )}
        </motion.div>
      )}
    </div>
  );
}
