import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { CalendarClock, Plus, Wallet, CheckCircle, XCircle, Loader2, Copy, ExternalLink, ArrowRight } from 'lucide-react';
import { useAccount, usePublicClient, useWriteContract } from 'wagmi';
import { formatEther, formatUnits, parseEther, parseUnits, toHex, zeroAddress, isAddress, type Hex } from 'viem';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { useToastStore } from '../../components/ToastContainer';
import { installmentPlanAbi, erc20ApproveAbi } from '../../lib/qantaraAbi';
import { INSTALLMENT_PLAN_ADDRESS, QUSDC_ADDRESS } from '../../lib/dealRoom';
import { qieMainnet } from '../../config/wagmi';

type Token = 'QIE' | 'QUSDC';
type Status = 0 | 1 | 2;

const STATUS_LABEL = ['Active', 'Completed', 'Cancelled'] as const;

interface PlanView {
  payer: `0x${string}`;
  merchant: `0x${string}`;
  token: `0x${string}`;
  amountPerInstallment: bigint;
  interval: bigint;
  totalInstallments: number;
  paidInstallments: number;
  claimedInstallments: number;
  createdAt: number;
  status: Status;
}

const tokenSymbol = (addr: string): Token => (addr.toLowerCase() === zeroAddress ? 'QIE' : 'QUSDC');
const formatAmount = (v: bigint, s: Token) => (s === 'QIE' ? formatEther(v) : formatUnits(v, 6));
const toWei = (amount: string, s: Token) => (s === 'QIE' ? parseEther(amount) : parseUnits(amount, 6));

export function InstallmentPlan() {
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: qieMainnet.id });
  const { writeContractAsync } = useWriteContract();
  const { addToast } = useToastStore();

  const [mode, setMode] = useState<'create' | 'manage'>('create');
  const [loadedId, setLoadedId] = useState<Hex | ''>('');
  const [plan, setPlan] = useState<PlanView | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const [createMerchant, setCreateMerchant] = useState('');
  const [createToken, setCreateToken] = useState<Token>('QIE');
  const [createAmount, setCreateAmount] = useState('');
  const [createCount, setCreateCount] = useState('12');
  const [createIntervalDays, setCreateIntervalDays] = useState('30');
  const [payCount, setPayCount] = useState('1');

  const contractReady = Boolean(INSTALLMENT_PLAN_ADDRESS);
  const ADDR = INSTALLMENT_PLAN_ADDRESS as `0x${string}`;

  const loadPlan = async (id: Hex) => {
    if (!publicClient) return;
    setIsLoading(true);
    try {
      const p = (await (publicClient as any).readContract({
        address: ADDR, abi: installmentPlanAbi, functionName: 'getPlan', args: [id],
      })) as PlanView;
      setPlan(p);
    } catch (err) {
      addToast('error', `Failed to load plan: ${(err as any)?.shortMessage ?? (err as Error).message}`);
      setPlan(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (mode !== 'manage') return;
    if (!loadedId || !/^0x[a-fA-F0-9]{64}$/.test(loadedId)) return;
    void loadPlan(loadedId as Hex);
  }, [loadedId, mode, address]);

  const tokenSym = plan ? tokenSymbol(plan.token) : createToken;

  const handleCreate = async () => {
    if (!address) return addToast('warning', 'Connect wallet first');
    if (!contractReady) return addToast('error', 'InstallmentPlan address not configured');
    if (!isAddress(createMerchant)) return addToast('error', 'Invalid merchant address');
    if (!createAmount || !/^\d+(\.\d+)?$/.test(createAmount)) return addToast('error', 'Invalid amount');
    const count = parseInt(createCount, 10);
    const days = parseInt(createIntervalDays, 10);
    if (!Number.isFinite(count) || count < 1) return addToast('error', 'Installments must be ≥ 1');
    if (!Number.isFinite(days) || days < 1) return addToast('error', 'Interval must be ≥ 1 day');

    setBusy(true);
    try {
      const salt = toHex(crypto.getRandomValues(new Uint8Array(32)));
      const tokenAddr = createToken === 'QIE' ? zeroAddress : (QUSDC_ADDRESS as `0x${string}`);
      if (createToken === 'QUSDC' && !QUSDC_ADDRESS) { addToast('error', 'QUSDC not configured'); return; }
      const per = toWei(createAmount, createToken);
      addToast('info', 'Confirm createPlan on mainnet');
      const tx = await writeContractAsync({
        account: address, chain: qieMainnet, address: ADDR, abi: installmentPlanAbi,
        functionName: 'createPlan',
        args: [createMerchant as `0x${string}`, tokenAddr, per, BigInt(days * 86400), count, salt],
      } as any);
      const r = await publicClient!.waitForTransactionReceipt({ hash: tx });
      addToast('success', `Plan created in block ${r.blockNumber}`);
      const id = (await (publicClient as any).readContract({
        address: ADDR, abi: installmentPlanAbi, functionName: 'computePlanId',
        args: [address, createMerchant as `0x${string}`, salt],
      })) as Hex;
      setLoadedId(id);
      setMode('manage');
      await loadPlan(id);
    } catch (err) {
      addToast('error', (err as any)?.shortMessage ?? (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handlePay = async () => {
    if (!address || !plan) return;
    const count = parseInt(payCount, 10);
    const remaining = plan.totalInstallments - plan.paidInstallments;
    if (!Number.isFinite(count) || count < 1 || count > remaining) return addToast('error', `Pay 1–${remaining} installments`);
    setBusy(true);
    try {
      const total = plan.amountPerInstallment * BigInt(count);
      if (tokenSym === 'QUSDC') {
        const allowance = (await (publicClient as any).readContract({
          address: QUSDC_ADDRESS!, abi: erc20ApproveAbi, functionName: 'allowance', args: [address, ADDR],
        })) as bigint;
        if (allowance < total) {
          addToast('info', 'Step 1/2: approve QUSDC');
          const ap = await writeContractAsync({
            account: address, chain: qieMainnet, address: QUSDC_ADDRESS!, abi: erc20ApproveAbi,
            functionName: 'approve', args: [ADDR, total],
          } as any);
          await publicClient!.waitForTransactionReceipt({ hash: ap });
        }
      }
      addToast('info', tokenSym === 'QIE' ? 'Confirm installment payment' : 'Step 2/2: confirm payment');
      const tx = await writeContractAsync({
        account: address, chain: qieMainnet, address: ADDR, abi: installmentPlanAbi,
        functionName: 'payInstallments', args: [loadedId as Hex, count],
        value: tokenSym === 'QIE' ? total : 0n,
      } as any);
      await publicClient!.waitForTransactionReceipt({ hash: tx });
      addToast('success', `Paid ${count} installment(s)`);
      await loadPlan(loadedId as Hex);
    } catch (err) {
      addToast('error', (err as any)?.shortMessage ?? (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const runWrite = async (functionName: 'claimInstallments' | 'cancelPlan', label: string) => {
    if (!address || !plan) return;
    setBusy(true);
    try {
      addToast('info', `Confirm ${label}`);
      const tx = await writeContractAsync({
        account: address, chain: qieMainnet, address: ADDR, abi: installmentPlanAbi,
        functionName, args: [loadedId as Hex],
      } as any);
      await publicClient!.waitForTransactionReceipt({ hash: tx });
      addToast('success', `${label} confirmed`);
      await loadPlan(loadedId as Hex);
    } catch (err) {
      addToast('error', (err as any)?.shortMessage ?? (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const isMerchant = plan && address && plan.merchant.toLowerCase() === address.toLowerCase();
  const isPayer = plan && address && plan.payer.toLowerCase() === address.toLowerCase();
  const claimable = plan ? plan.paidInstallments - plan.claimedInstallments : 0;
  const remaining = plan ? plan.totalInstallments - plan.paidInstallments : 0;
  const progress = useMemo(() => (plan && plan.totalInstallments > 0
    ? Math.round((plan.paidInstallments / plan.totalInstallments) * 100) : 0), [plan]);
  const explorerUrl = qieMainnet.blockExplorers.default.url;

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <CalendarClock className="w-8 h-8 text-primary" />
          <h1 className="text-4xl font-bold text-white tracking-tight">Installment Plan</h1>
        </div>
        <p className="text-text-muted">Pay over time. The payer commits to N installments and pays them on schedule; the merchant claims what's paid. Not prefunded — the payer can cancel and is refunded any installment not yet claimed.</p>
      </div>

      {!contractReady && (
        <Card className="p-4 border border-yellow-500/30 bg-yellow-500/5 text-yellow-300 text-sm">
          VITE_INSTALLMENT_PLAN_ADDRESS is not configured.
        </Card>
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
              <input type="text" placeholder="0x…" value={createMerchant} onChange={(e) => setCreateMerchant(e.target.value.trim())}
                className="w-full mt-2 px-3 py-2 bg-surface-1 border border-border-default rounded text-white font-mono text-xs" />
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-widest text-text-muted">Token</label>
              <div className="flex gap-2 mt-2">
                {(['QIE', 'QUSDC'] as Token[]).map((t) => (
                  <button key={t} onClick={() => setCreateToken(t)} className={`px-4 py-2 text-sm font-bold rounded border ${createToken === t ? 'border-primary bg-primary/10 text-primary' : 'border-border-default text-text-muted hover:text-white'}`}>{t}</button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="text-xs font-bold uppercase tracking-widest text-text-muted">Per installment</label>
                <input type="text" inputMode="decimal" placeholder={`0.0 ${createToken}`} value={createAmount} onChange={(e) => setCreateAmount(e.target.value)}
                  className="w-full mt-2 px-3 py-2 bg-surface-1 border border-border-default rounded text-white" />
              </div>
              <div>
                <label className="text-xs font-bold uppercase tracking-widest text-text-muted">Installments</label>
                <input type="number" min={1} value={createCount} onChange={(e) => setCreateCount(e.target.value)}
                  className="w-full mt-2 px-3 py-2 bg-surface-1 border border-border-default rounded text-white" />
              </div>
              <div>
                <label className="text-xs font-bold uppercase tracking-widest text-text-muted">Every (days)</label>
                <input type="number" min={1} value={createIntervalDays} onChange={(e) => setCreateIntervalDays(e.target.value)}
                  className="w-full mt-2 px-3 py-2 bg-surface-1 border border-border-default rounded text-white" />
              </div>
            </div>
            {createAmount && /^\d+(\.\d+)?$/.test(createAmount) && (
              <p className="text-xs text-text-muted">Total over plan: {(parseFloat(createAmount) * (parseInt(createCount, 10) || 0)).toFixed(6)} {createToken}</p>
            )}
            <Button onClick={handleCreate} loading={busy} disabled={!contractReady || !address} className="w-full">
              <Plus className="w-4 h-4 mr-1" /> Create Plan
            </Button>
          </Card>
        </motion.div>
      )}

      {mode === 'manage' && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <Card className="p-6 space-y-3">
            <label className="text-xs font-bold uppercase tracking-widest text-text-muted">Plan id</label>
            <input type="text" placeholder="0x… (64 hex)" value={loadedId} onChange={(e) => setLoadedId(e.target.value.trim() as Hex)}
              className="w-full px-3 py-2 bg-surface-1 border border-border-default rounded text-white font-mono text-xs" />
          </Card>

          {isLoading && (
            <div className="text-center text-text-muted text-sm py-4"><Loader2 className="inline w-4 h-4 mr-2 animate-spin" /> Loading from contract…</div>
          )}

          {plan && (
            <Card className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-text-muted uppercase tracking-widest">Status</div>
                  <div className={`text-xl font-bold ${plan.status === 0 ? 'text-primary' : plan.status === 1 ? 'text-green-400' : 'text-text-muted'}`}>{STATUS_LABEL[plan.status]}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-text-muted uppercase tracking-widest">Paid</div>
                  <div className="text-2xl font-bold text-white tabular-nums">{plan.paidInstallments}/{plan.totalInstallments}</div>
                  <div className="text-xs text-text-muted">{formatAmount(plan.amountPerInstallment, tokenSym)} {tokenSym} each · {progress}%</div>
                </div>
              </div>

              <div className="flex h-3 rounded overflow-hidden bg-surface-2">
                {Array.from({ length: plan.totalInstallments }).map((_, i) => (
                  <div key={i} className={`flex-1 border-r border-bg-base last:border-r-0 ${i < plan.claimedInstallments ? 'bg-primary' : i < plan.paidInstallments ? 'bg-primary/40' : 'bg-transparent'}`} />
                ))}
              </div>
              <div className="text-[10px] text-text-muted">Filled = paid · solid = claimed by merchant</div>

              <div className="text-xs space-y-1 font-mono">
                <div><span className="text-text-muted">Payer: </span><a href={`${explorerUrl}/address/${plan.payer}`} target="_blank" rel="noreferrer" className="hover:text-primary inline-flex items-center gap-1">{plan.payer.slice(0, 10)}…{plan.payer.slice(-6)} <ExternalLink className="w-3 h-3" /></a></div>
                <div><span className="text-text-muted">Merchant: </span><a href={`${explorerUrl}/address/${plan.merchant}`} target="_blank" rel="noreferrer" className="hover:text-primary inline-flex items-center gap-1">{plan.merchant.slice(0, 10)}…{plan.merchant.slice(-6)} <ExternalLink className="w-3 h-3" /></a></div>
                <div className="flex items-center gap-2"><span className="text-text-muted">Id: </span>{(loadedId as string).slice(0, 14)}…<button onClick={() => { void navigator.clipboard.writeText(loadedId); addToast('success', 'Copied'); }} className="text-primary hover:text-white"><Copy className="w-3 h-3" /></button></div>
              </div>

              {plan.status === 0 && isPayer && remaining > 0 && (
                <div className="border-t border-border-default pt-4 space-y-2">
                  <label className="text-xs font-bold uppercase tracking-widest text-text-muted">Pay installments (max {remaining})</label>
                  <div className="flex gap-2">
                    <input type="number" min={1} max={remaining} value={payCount} onChange={(e) => setPayCount(e.target.value)}
                      className="w-24 px-3 py-2 bg-surface-1 border border-border-default rounded text-white" />
                    <Button onClick={handlePay} loading={busy} className="flex-1">
                      <ArrowRight className="w-4 h-4 mr-1" /> Pay {(parseFloat(formatAmount(plan.amountPerInstallment, tokenSym)) * (parseInt(payCount, 10) || 0)).toFixed(6)} {tokenSym}
                    </Button>
                  </div>
                </div>
              )}

              {plan.status === 0 && isMerchant && claimable > 0 && (
                <div className="border-t border-border-default pt-4">
                  <Button onClick={() => runWrite('claimInstallments', `Claim ${claimable} installment(s)`)} loading={busy} className="w-full">
                    <CheckCircle className="w-4 h-4 mr-1" /> Claim {formatAmount(plan.amountPerInstallment * BigInt(claimable), tokenSym)} {tokenSym} ({claimable} paid)
                  </Button>
                </div>
              )}

              {plan.status === 0 && isPayer && (
                <div className="border-t border-border-default pt-4">
                  <Button variant="secondary" onClick={() => runWrite('cancelPlan', 'Cancel plan')} loading={busy} className="w-full">
                    <XCircle className="w-4 h-4 mr-1" /> Cancel plan (refund {formatAmount(plan.amountPerInstallment * BigInt(claimable), tokenSym)} {tokenSym} unclaimed)
                  </Button>
                </div>
              )}

              {plan.status === 1 && (
                <div className="border-t border-border-default pt-4 text-center text-sm text-green-400"><CheckCircle className="inline w-4 h-4 mr-1" /> Plan complete — all installments claimed.</div>
              )}
            </Card>
          )}
        </motion.div>
      )}
    </div>
  );
}
