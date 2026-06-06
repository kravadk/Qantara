import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Repeat, Plus, Wallet, CheckCircle, XCircle, Loader2, Copy, ExternalLink, Clock } from 'lucide-react';
import { useAccount, usePublicClient, useWriteContract } from 'wagmi';
import { formatEther, formatUnits, parseEther, parseUnits, toHex, zeroAddress, isAddress, type Hex } from 'viem';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { useToastStore } from '../../components/ToastContainer';
import { recurringSchedulerAbi, erc20ApproveAbi } from '../../lib/qantaraAbi';
import { RECURRING_SCHEDULER_ADDRESS, QUSDC_ADDRESS } from '../../lib/dealRoom';
import { qieMainnet } from '../../config/wagmi';

type Token = 'QIE' | 'QUSDC';
type Status = 0 | 1 | 2;

const STATUS_LABEL = ['Active', 'Completed', 'Cancelled'] as const;
const HOUR = 3600;
const DAY = 86400;
const WEEK = 604800;
const MONTH = 2_592_000;

const INTERVAL_PRESETS: { label: string; seconds: number }[] = [
  { label: 'Hourly', seconds: HOUR },
  { label: 'Daily', seconds: DAY },
  { label: 'Weekly', seconds: WEEK },
  { label: 'Monthly', seconds: MONTH },
];

interface SubView {
  payer: `0x${string}`;
  merchant: `0x${string}`;
  token: `0x${string}`;
  amountPerPeriod: bigint;
  interval: number;
  totalPeriods: number;
  claimedPeriods: number;
  startedAt: number;
  status: Status;
}

function tokenSymbol(addr: string): Token {
  return addr.toLowerCase() === zeroAddress ? 'QIE' : 'QUSDC';
}

function formatAmount(value: bigint, sym: Token): string {
  return sym === 'QIE' ? formatEther(value) : formatUnits(value, 6);
}

function formatInterval(sec: number): string {
  const m = INTERVAL_PRESETS.find((p) => p.seconds === sec);
  if (m) return m.label;
  if (sec >= WEEK) return `${(sec / WEEK).toFixed(1)} weeks`;
  if (sec >= DAY) return `${(sec / DAY).toFixed(1)} days`;
  return `${Math.round(sec / HOUR)} h`;
}

export function Subscription() {
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: qieMainnet.id });
  const { writeContractAsync } = useWriteContract();
  const { addToast } = useToastStore();

  const [mode, setMode] = useState<'create' | 'manage'>('create');
  const [loadedId, setLoadedId] = useState<Hex | ''>('');
  const [sub, setSub] = useState<SubView | null>(null);
  const [accrued, setAccrued] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(false);

  const [createMerchant, setCreateMerchant] = useState('');
  const [createToken, setCreateToken] = useState<Token>('QIE');
  const [createAmountPerPeriod, setCreateAmountPerPeriod] = useState('');
  const [createInterval, setCreateInterval] = useState<number>(WEEK);
  const [createPeriods, setCreatePeriods] = useState('12');

  const contractReady = Boolean(RECURRING_SCHEDULER_ADDRESS);

  const loadSub = async (id: Hex) => {
    if (!publicClient) return;
    setIsLoading(true);
    try {
      const s = (await (publicClient as any).readContract({
        address: RECURRING_SCHEDULER_ADDRESS!,
        abi: recurringSchedulerAbi,
        functionName: 'getSubscription',
        args: [id],
      })) as SubView;
      setSub(s);
      const a = (await (publicClient as any).readContract({
        address: RECURRING_SCHEDULER_ADDRESS!,
        abi: recurringSchedulerAbi,
        functionName: 'accruedPeriods',
        args: [id],
      })) as number;
      setAccrued(Number(a));
    } catch (err) {
      addToast('error', `Failed to load subscription: ${(err as any)?.shortMessage ?? (err as Error).message}`);
      setSub(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (mode !== 'manage') return;
    if (!loadedId || !/^0x[a-fA-F0-9]{64}$/.test(loadedId)) return;
    void loadSub(loadedId as Hex);
  }, [loadedId, mode, address]);

  useEffect(() => {
    if (!sub || sub.status !== 0 || !loadedId) return;
    const t = setInterval(() => void loadSub(loadedId as Hex), 30_000);
    return () => clearInterval(t);
  }, [sub, loadedId]);

  const tokenSym = sub ? tokenSymbol(sub.token) : createToken;

  const handleCreate = async () => {
    if (!address) return addToast('warning', 'Connect wallet first');
    if (!contractReady) return addToast('error', 'RecurringScheduler not configured');
    if (!isAddress(createMerchant)) return addToast('error', 'Invalid merchant address');
    if (!createAmountPerPeriod || !/^\d+(\.\d+)?$/.test(createAmountPerPeriod)) return addToast('error', 'Invalid amount');
    const periods = parseInt(createPeriods, 10);
    if (!Number.isFinite(periods) || periods <= 0) return addToast('error', 'Invalid periods');

    try {
      const saltBytes = crypto.getRandomValues(new Uint8Array(32));
      const salt = toHex(saltBytes);
      const tokenAddr = createToken === 'QIE' ? zeroAddress : (QUSDC_ADDRESS as `0x${string}`);
      const amountWei = createToken === 'QIE' ? parseEther(createAmountPerPeriod) : parseUnits(createAmountPerPeriod, 6);
      const totalWei = amountWei * BigInt(periods);

      if (createToken === 'QUSDC') {
        if (!QUSDC_ADDRESS) return addToast('error', 'QUSDC address not configured');
        const allowance = (await (publicClient as any).readContract({
          address: QUSDC_ADDRESS,
          abi: erc20ApproveAbi,
          functionName: 'allowance',
          args: [address, RECURRING_SCHEDULER_ADDRESS!],
        })) as bigint;
        if (allowance < totalWei) {
          addToast('info', 'Step 1/2: approve QUSDC');
          const ap = await writeContractAsync({
            account: address,
            chain: qieMainnet,
            address: QUSDC_ADDRESS,
            abi: erc20ApproveAbi,
            functionName: 'approve',
            args: [RECURRING_SCHEDULER_ADDRESS!, totalWei],
          } as any);
          await publicClient!.waitForTransactionReceipt({ hash: ap });
        }
      }

      addToast('info', createToken === 'QIE' ? 'Confirm createSubscription' : 'Step 2/2: confirm createSubscription');
      const tx = await writeContractAsync({
        account: address,
        chain: qieMainnet,
        address: RECURRING_SCHEDULER_ADDRESS!,
        abi: recurringSchedulerAbi,
        functionName: 'createSubscription',
        args: [
          createMerchant as `0x${string}`,
          tokenAddr,
          amountWei,
          BigInt(createInterval),
          periods,
          salt as Hex,
        ],
        value: createToken === 'QIE' ? totalWei : 0n,
      } as any);
      const r = await publicClient!.waitForTransactionReceipt({ hash: tx });
      addToast('success', `Subscription created in block ${r.blockNumber}`);

      const id = (await (publicClient as any).readContract({
        address: RECURRING_SCHEDULER_ADDRESS!,
        abi: recurringSchedulerAbi,
        functionName: 'computeSubId',
        args: [address, createMerchant as `0x${string}`, salt as Hex],
      })) as Hex;
      setLoadedId(id);
      setMode('manage');
      await loadSub(id);
    } catch (err) {
      addToast('error', (err as any)?.shortMessage ?? (err as Error).message);
    }
  };

  const runWrite = async (functionName: 'claim' | 'cancel', label: string) => {
    if (!address || !sub) return;
    try {
      addToast('info', `Confirm ${label}`);
      const tx = await writeContractAsync({
        account: address,
        chain: qieMainnet,
        address: RECURRING_SCHEDULER_ADDRESS!,
        abi: recurringSchedulerAbi,
        functionName,
        args: [loadedId as Hex],
      } as any);
      await publicClient!.waitForTransactionReceipt({ hash: tx });
      addToast('success', `${label} confirmed`);
      await loadSub(loadedId as Hex);
    } catch (err) {
      addToast('error', (err as any)?.shortMessage ?? (err as Error).message);
    }
  };

  const isMerchant = sub && address && sub.merchant.toLowerCase() === address.toLowerCase();
  const isPayer = sub && address && sub.payer.toLowerCase() === address.toLowerCase();
  const progressPct = sub ? (sub.claimedPeriods / sub.totalPeriods) * 100 : 0;

  const explorerUrl = qieMainnet.blockExplorers.default.url;
  const totalDepositPreview = (() => {
    const p = parseInt(createPeriods, 10);
    const a = parseFloat(createAmountPerPeriod);
    if (Number.isFinite(p) && Number.isFinite(a) && p > 0 && a > 0) return (a * p).toFixed(6);
    return null;
  })();

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <Repeat className="w-8 h-8 text-primary" />
          <h1 className="text-4xl font-bold text-white tracking-tight">Recurring Subscription</h1>
        </div>
        <p className="text-text-muted">Payer deposits the full subscription upfront. Merchant claims one period per interval. Either party may cancel — accrued share goes to merchant, remainder refunds to payer.</p>
      </div>

      {!contractReady && (
        <Card className="p-4 border border-yellow-500/30 bg-yellow-500/5 text-yellow-300 text-sm">
          VITE_RECURRING_SCHEDULER_ADDRESS is not configured.
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
              <label className="text-xs font-bold uppercase tracking-widest text-text-muted">Merchant address</label>
              <input type="text" placeholder="0x…" value={createMerchant} onChange={(e) => setCreateMerchant(e.target.value.trim())} className="w-full mt-2 px-3 py-2 bg-surface-1 border border-border-default rounded text-white font-mono text-xs" />
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-widest text-text-muted">Token</label>
              <div className="flex gap-2 mt-2">
                {(['QIE', 'QUSDC'] as Token[]).map((t) => (
                  <button key={t} onClick={() => setCreateToken(t)} className={`px-4 py-2 text-sm font-bold rounded border ${createToken === t ? 'border-primary bg-primary/10 text-primary' : 'border-border-default text-text-muted hover:text-white'}`}>{t}</button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-bold uppercase tracking-widest text-text-muted">Amount per period</label>
                <input type="text" inputMode="decimal" placeholder={`e.g. 0.1 ${createToken}`} value={createAmountPerPeriod} onChange={(e) => setCreateAmountPerPeriod(e.target.value)} className="w-full mt-2 px-3 py-2 bg-surface-1 border border-border-default rounded text-white" />
              </div>
              <div>
                <label className="text-xs font-bold uppercase tracking-widest text-text-muted">Periods</label>
                <input type="number" min={1} value={createPeriods} onChange={(e) => setCreatePeriods(e.target.value)} className="w-full mt-2 px-3 py-2 bg-surface-1 border border-border-default rounded text-white" />
              </div>
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-widest text-text-muted">Interval</label>
              <div className="flex flex-wrap gap-2 mt-2">
                {INTERVAL_PRESETS.map((p) => (
                  <button key={p.seconds} onClick={() => setCreateInterval(p.seconds)} className={`px-3 py-1.5 text-xs font-bold rounded border ${createInterval === p.seconds ? 'border-primary bg-primary/10 text-primary' : 'border-border-default text-text-muted hover:text-white'}`}>{p.label}</button>
                ))}
              </div>
            </div>
            {totalDepositPreview && (
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm">
                <span className="text-text-muted">Total upfront deposit: </span>
                <span className="font-bold text-primary">{totalDepositPreview} {createToken}</span>
              </div>
            )}
            <Button onClick={handleCreate} disabled={!contractReady || !address} className="w-full">
              <Plus className="w-4 h-4 mr-1" /> Fund Subscription
            </Button>
          </Card>
        </motion.div>
      )}

      {mode === 'manage' && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <Card className="p-6 space-y-3">
            <label className="text-xs font-bold uppercase tracking-widest text-text-muted">Subscription id</label>
            <input type="text" placeholder="0x… (64 hex)" value={loadedId} onChange={(e) => setLoadedId(e.target.value.trim() as Hex)} className="w-full px-3 py-2 bg-surface-1 border border-border-default rounded text-white font-mono text-xs" />
          </Card>

          {isLoading && (
            <div className="text-center text-text-muted text-sm py-4"><Loader2 className="inline w-4 h-4 mr-2 animate-spin" /> Loading…</div>
          )}

          {sub && (
            <Card className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-text-muted uppercase tracking-widest">Status</div>
                  <div className={`text-xl font-bold ${sub.status === 0 ? 'text-primary' : sub.status === 1 ? 'text-green-400' : 'text-text-muted'}`}>{STATUS_LABEL[sub.status]}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-text-muted uppercase tracking-widest">Progress</div>
                  <div className="text-2xl font-bold text-white">{sub.claimedPeriods}/{sub.totalPeriods}</div>
                  <div className="text-xs text-text-muted">{formatAmount(sub.amountPerPeriod, tokenSym)} {tokenSym} × {formatInterval(sub.interval)}</div>
                </div>
              </div>

              <div className="h-2 rounded overflow-hidden bg-surface-2">
                <div className="h-full bg-primary transition-all" style={{ width: `${progressPct}%` }} />
              </div>

              <div className="text-xs space-y-1 font-mono">
                <div><span className="text-text-muted">Payer: </span><a href={`${explorerUrl}/address/${sub.payer}`} target="_blank" rel="noreferrer" className="hover:text-primary inline-flex items-center gap-1">{sub.payer.slice(0, 10)}…{sub.payer.slice(-6)} <ExternalLink className="w-3 h-3" /></a></div>
                <div><span className="text-text-muted">Merchant: </span><a href={`${explorerUrl}/address/${sub.merchant}`} target="_blank" rel="noreferrer" className="hover:text-primary inline-flex items-center gap-1">{sub.merchant.slice(0, 10)}…{sub.merchant.slice(-6)} <ExternalLink className="w-3 h-3" /></a></div>
                <div><span className="text-text-muted">Started: </span>{new Date(sub.startedAt * 1000).toLocaleString()}</div>
                <div className="flex items-center gap-2"><span className="text-text-muted">Id: </span>{loadedId.slice(0, 14)}…<button onClick={() => { void navigator.clipboard.writeText(loadedId); addToast('success', 'Copied'); }} className="text-primary hover:text-white"><Copy className="w-3 h-3" /></button></div>
              </div>

              {sub.status === 0 && (
                <div className="border-t border-border-default pt-4 space-y-3">
                  <div className="flex items-center justify-between rounded-lg border border-border-default bg-surface-2 p-3">
                    <div className="flex items-center gap-2 text-sm">
                      <Clock className="w-4 h-4 text-text-muted" />
                      <span className="text-text-muted">Accrued periods:</span>
                      <span className="font-bold text-white">{accrued}</span>
                    </div>
                    {accrued > 0 && <span className="text-xs text-primary font-bold">{formatAmount(BigInt(accrued) * sub.amountPerPeriod, tokenSym)} {tokenSym} claimable</span>}
                  </div>
                  {isMerchant && accrued > 0 && (
                    <Button onClick={() => runWrite('claim', `Claim ${accrued} period${accrued > 1 ? 's' : ''}`)} className="w-full">
                      Claim {accrued} period{accrued > 1 ? 's' : ''} ({formatAmount(BigInt(accrued) * sub.amountPerPeriod, tokenSym)} {tokenSym})
                    </Button>
                  )}
                  {(isPayer || isMerchant) && (
                    <Button variant="secondary" onClick={() => runWrite('cancel', 'Cancel subscription')} className="w-full">
                      <XCircle className="w-4 h-4 mr-1" /> Cancel — refund {sub.totalPeriods - sub.claimedPeriods - accrued} unused period{(sub.totalPeriods - sub.claimedPeriods - accrued) === 1 ? '' : 's'} to payer
                    </Button>
                  )}
                </div>
              )}

              {sub.status === 1 && (
                <div className="border-t border-border-default pt-4 text-center text-sm text-green-400">
                  <CheckCircle className="inline w-4 h-4 mr-1" /> Subscription completed — all {sub.totalPeriods} periods claimed.
                </div>
              )}
            </Card>
          )}
        </motion.div>
      )}
    </div>
  );
}
