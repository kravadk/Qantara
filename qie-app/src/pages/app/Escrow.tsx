import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Shield, Plus, Wallet, CheckCircle, XCircle, Loader2, Copy, ExternalLink, ArrowRight } from 'lucide-react';
import { useAccount, usePublicClient, useWriteContract } from 'wagmi';
import { formatEther, formatUnits, parseEther, parseUnits, toHex, zeroAddress, isAddress, type Hex } from 'viem';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { useToastStore } from '../../components/ToastContainer';
import { milestoneEscrowAbi, erc20ApproveAbi } from '../../lib/qantaraAbi';
import { MILESTONE_ESCROW_ADDRESS, QUSDC_ADDRESS } from '../../lib/dealRoom';
import { qieMainnet } from '../../config/wagmi';

type Token = 'QIE' | 'QUSDC';
type Status = 0 | 1 | 2;

const STATUS_LABEL = ['Active', 'Completed', 'Refunded'] as const;

interface EscrowView {
  payer: `0x${string}`;
  merchant: `0x${string}`;
  token: `0x${string}`;
  arbiter: `0x${string}`;
  totalAmount: bigint;
  claimedAmount: bigint;
  nextTier: number;
  createdAt: number;
  status: Status;
}

function tokenSymbol(addr: string): Token {
  return addr.toLowerCase() === zeroAddress ? 'QIE' : 'QUSDC';
}

function formatAmount(value: bigint, sym: Token): string {
  return sym === 'QIE' ? formatEther(value) : formatUnits(value, 6);
}

export function Escrow() {
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: qieMainnet.id });
  const { writeContractAsync } = useWriteContract();
  const { addToast } = useToastStore();

  const [mode, setMode] = useState<'create' | 'manage'>('create');
  const [loadedId, setLoadedId] = useState<Hex | ''>('');
  const [escrow, setEscrow] = useState<EscrowView | null>(null);
  const [nextPreview, setNextPreview] = useState<{ tier: number; amount: bigint } | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const [createMerchant, setCreateMerchant] = useState('');
  const [createArbiter, setCreateArbiter] = useState('');
  const [createToken, setCreateToken] = useState<Token>('QIE');
  const [createAmount, setCreateAmount] = useState('');

  const contractReady = Boolean(MILESTONE_ESCROW_ADDRESS);

  const loadEscrow = async (id: Hex) => {
    if (!publicClient) return;
    setIsLoading(true);
    try {
      const e = (await (publicClient as any).readContract({
        address: MILESTONE_ESCROW_ADDRESS!,
        abi: milestoneEscrowAbi,
        functionName: 'getEscrow',
        args: [id],
      })) as EscrowView;
      setEscrow(e);
      const [tier, amount] = (await (publicClient as any).readContract({
        address: MILESTONE_ESCROW_ADDRESS!,
        abi: milestoneEscrowAbi,
        functionName: 'previewNextMilestone',
        args: [id],
      })) as [number, bigint];
      setNextPreview({ tier, amount });
    } catch (err) {
      addToast('error', `Failed to load escrow: ${(err as any)?.shortMessage ?? (err as Error).message}`);
      setEscrow(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (mode !== 'manage') return;
    if (!loadedId || !/^0x[a-fA-F0-9]{64}$/.test(loadedId)) return;
    void loadEscrow(loadedId as Hex);
  }, [loadedId, mode, address]);

  const tokenSym = escrow ? tokenSymbol(escrow.token) : createToken;

  const handleCreate = async () => {
    if (!address) return addToast('warning', 'Connect wallet first');
    if (!contractReady) return addToast('error', 'MilestoneEscrow address not configured');
    if (!isAddress(createMerchant)) return addToast('error', 'Invalid merchant address');
    if (createArbiter && !isAddress(createArbiter)) return addToast('error', 'Invalid arbiter address');
    if (!createAmount || !/^\d+(\.\d+)?$/.test(createAmount)) return addToast('error', 'Invalid amount');

    try {
      const saltBytes = crypto.getRandomValues(new Uint8Array(32));
      const salt = toHex(saltBytes);
      const tokenAddr = createToken === 'QIE' ? zeroAddress : (QUSDC_ADDRESS as `0x${string}`);
      const arbiterAddr = (createArbiter ? createArbiter : zeroAddress) as `0x${string}`;
      const totalWei = createToken === 'QIE' ? parseEther(createAmount) : parseUnits(createAmount, 6);

      if (createToken === 'QUSDC') {
        if (!QUSDC_ADDRESS) return addToast('error', 'QUSDC address not configured');
        const allowance = (await (publicClient as any).readContract({
          address: QUSDC_ADDRESS,
          abi: erc20ApproveAbi,
          functionName: 'allowance',
          args: [address, MILESTONE_ESCROW_ADDRESS!],
        })) as bigint;
        if (allowance < totalWei) {
          addToast('info', 'Step 1/2: approve QUSDC to escrow');
          const ap = await writeContractAsync({
            account: address,
            chain: qieMainnet,
            address: QUSDC_ADDRESS,
            abi: erc20ApproveAbi,
            functionName: 'approve',
            args: [MILESTONE_ESCROW_ADDRESS!, totalWei],
          } as any);
          await publicClient!.waitForTransactionReceipt({ hash: ap });
        }
      }

      addToast('info', createToken === 'QIE' ? 'Confirm createEscrow on mainnet' : 'Step 2/2: confirm createEscrow');
      const tx = await writeContractAsync({
        account: address,
        chain: qieMainnet,
        address: MILESTONE_ESCROW_ADDRESS!,
        abi: milestoneEscrowAbi,
        functionName: 'createEscrow',
        args: [createMerchant as `0x${string}`, tokenAddr, arbiterAddr, totalWei, salt as Hex],
        value: createToken === 'QIE' ? totalWei : 0n,
      } as any);
      const r = await publicClient!.waitForTransactionReceipt({ hash: tx });
      addToast('success', `Escrow created in block ${r.blockNumber}`);

      const id = (await (publicClient as any).readContract({
        address: MILESTONE_ESCROW_ADDRESS!,
        abi: milestoneEscrowAbi,
        functionName: 'computeEscrowId',
        args: [address, createMerchant as `0x${string}`, salt as Hex],
      })) as Hex;
      setLoadedId(id);
      setMode('manage');
      await loadEscrow(id);
    } catch (err) {
      addToast('error', (err as any)?.shortMessage ?? (err as Error).message);
    }
  };

  const runWrite = async (functionName: 'claimMilestone' | 'refundRemainder', label: string) => {
    if (!address || !escrow) return;
    try {
      addToast('info', `Confirm ${label}`);
      const tx = await writeContractAsync({
        account: address,
        chain: qieMainnet,
        address: MILESTONE_ESCROW_ADDRESS!,
        abi: milestoneEscrowAbi,
        functionName,
        args: [loadedId as Hex],
      } as any);
      await publicClient!.waitForTransactionReceipt({ hash: tx });
      addToast('success', `${label} confirmed`);
      await loadEscrow(loadedId as Hex);
    } catch (err) {
      addToast('error', (err as any)?.shortMessage ?? (err as Error).message);
    }
  };

  const isMerchant = escrow && address && escrow.merchant.toLowerCase() === address.toLowerCase();
  const isArbiter = escrow && address && escrow.arbiter !== zeroAddress && escrow.arbiter.toLowerCase() === address.toLowerCase();
  const progress = useMemo(() => {
    if (!escrow || escrow.totalAmount === 0n) return 0;
    return Number((escrow.claimedAmount * 1000n) / escrow.totalAmount) / 10;
  }, [escrow]);

  const explorerUrl = qieMainnet.blockExplorers.default.url;

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <Shield className="w-8 h-8 text-primary" />
          <h1 className="text-4xl font-bold text-white tracking-tight">Milestone Escrow</h1>
        </div>
        <p className="text-text-muted">Pre-funded escrow with 4 milestone tiers (25 / 50 / 75 / 100%). Merchant claims sequentially. Optional arbiter can refund remainder.</p>
      </div>

      {!contractReady && (
        <Card className="p-4 border border-yellow-500/30 bg-yellow-500/5 text-yellow-300 text-sm">
          VITE_MILESTONE_ESCROW_ADDRESS is not configured. Set it in your .env to use this page.
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
              <input
                type="text"
                placeholder="0x…"
                value={createMerchant}
                onChange={(e) => setCreateMerchant(e.target.value.trim())}
                className="w-full mt-2 px-3 py-2 bg-surface-1 border border-border-default rounded text-white font-mono text-xs"
              />
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-widest text-text-muted">Arbiter (optional)</label>
              <input
                type="text"
                placeholder="0x… or leave empty for no dispute resolver"
                value={createArbiter}
                onChange={(e) => setCreateArbiter(e.target.value.trim())}
                className="w-full mt-2 px-3 py-2 bg-surface-1 border border-border-default rounded text-white font-mono text-xs"
              />
            </div>
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
              <label className="text-xs font-bold uppercase tracking-widest text-text-muted">Total amount</label>
              <input
                type="text"
                inputMode="decimal"
                placeholder={`e.g. 1.0 ${createToken}`}
                value={createAmount}
                onChange={(e) => setCreateAmount(e.target.value)}
                className="w-full mt-2 px-3 py-2 bg-surface-1 border border-border-default rounded text-white"
              />
              {createAmount && /^\d+(\.\d+)?$/.test(createAmount) && (
                <p className="text-xs text-text-muted mt-1">Each tier = {(parseFloat(createAmount) / 4).toFixed(6)} {createToken}</p>
              )}
            </div>
            <Button onClick={handleCreate} disabled={!contractReady || !address} className="w-full">
              <Plus className="w-4 h-4 mr-1" /> Fund Escrow
            </Button>
          </Card>
        </motion.div>
      )}

      {mode === 'manage' && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <Card className="p-6 space-y-3">
            <label className="text-xs font-bold uppercase tracking-widest text-text-muted">Escrow id</label>
            <input
              type="text"
              placeholder="0x… (64 hex)"
              value={loadedId}
              onChange={(e) => setLoadedId(e.target.value.trim() as Hex)}
              className="w-full px-3 py-2 bg-surface-1 border border-border-default rounded text-white font-mono text-xs"
            />
          </Card>

          {isLoading && (
            <div className="text-center text-text-muted text-sm py-4">
              <Loader2 className="inline w-4 h-4 mr-2 animate-spin" /> Loading from contract…
            </div>
          )}

          {escrow && (
            <Card className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-text-muted uppercase tracking-widest">Status</div>
                  <div className={`text-xl font-bold ${escrow.status === 0 ? 'text-primary' : escrow.status === 1 ? 'text-green-400' : 'text-text-muted'}`}>
                    {STATUS_LABEL[escrow.status]}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-text-muted uppercase tracking-widest">Claimed</div>
                  <div className="text-2xl font-bold text-white">
                    {formatAmount(escrow.claimedAmount, tokenSym)} <span className="text-sm text-text-muted">{tokenSym}</span>
                  </div>
                  <div className="text-xs text-text-muted">of {formatAmount(escrow.totalAmount, tokenSym)} {tokenSym} ({progress}%)</div>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex h-3 rounded overflow-hidden bg-surface-2">
                  {[0, 1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className={`flex-1 border-r border-bg-base last:border-r-0 ${i < escrow.nextTier ? 'bg-primary' : 'bg-transparent'}`}
                    />
                  ))}
                </div>
                <div className="flex justify-between text-[10px] text-text-muted uppercase tracking-widest">
                  <span>25%</span><span>50%</span><span>75%</span><span>100%</span>
                </div>
              </div>

              <div className="text-xs space-y-1 font-mono">
                <div><span className="text-text-muted">Payer: </span><a href={`${explorerUrl}/address/${escrow.payer}`} target="_blank" rel="noreferrer" className="hover:text-primary inline-flex items-center gap-1">{escrow.payer.slice(0, 10)}…{escrow.payer.slice(-6)} <ExternalLink className="w-3 h-3" /></a></div>
                <div><span className="text-text-muted">Merchant: </span><a href={`${explorerUrl}/address/${escrow.merchant}`} target="_blank" rel="noreferrer" className="hover:text-primary inline-flex items-center gap-1">{escrow.merchant.slice(0, 10)}…{escrow.merchant.slice(-6)} <ExternalLink className="w-3 h-3" /></a></div>
                {escrow.arbiter !== zeroAddress && (
                  <div><span className="text-text-muted">Arbiter: </span><a href={`${explorerUrl}/address/${escrow.arbiter}`} target="_blank" rel="noreferrer" className="hover:text-primary inline-flex items-center gap-1">{escrow.arbiter.slice(0, 10)}…{escrow.arbiter.slice(-6)} <ExternalLink className="w-3 h-3" /></a></div>
                )}
                <div className="flex items-center gap-2"><span className="text-text-muted">Id: </span>{loadedId.slice(0, 14)}…<button onClick={() => { void navigator.clipboard.writeText(loadedId); addToast('success', 'Copied'); }} className="text-primary hover:text-white"><Copy className="w-3 h-3" /></button></div>
              </div>

              {escrow.status === 0 && isMerchant && nextPreview && nextPreview.amount > 0n && (
                <div className="border-t border-border-default pt-4">
                  <div className="text-xs text-text-muted mb-2">Next milestone (tier {nextPreview.tier + 1}/4):</div>
                  <Button onClick={() => runWrite('claimMilestone', `Claim tier ${nextPreview.tier + 1}`)} className="w-full">
                    <ArrowRight className="w-4 h-4 mr-1" /> Claim {formatAmount(nextPreview.amount, tokenSym)} {tokenSym}
                  </Button>
                </div>
              )}

              {escrow.status === 0 && (isMerchant || isArbiter) && escrow.claimedAmount < escrow.totalAmount && (
                <div className="border-t border-border-default pt-4">
                  <Button variant="secondary" onClick={() => runWrite('refundRemainder', 'Refund remainder')} className="w-full">
                    <XCircle className="w-4 h-4 mr-1" /> Refund remainder to payer ({formatAmount(escrow.totalAmount - escrow.claimedAmount, tokenSym)} {tokenSym})
                  </Button>
                  <p className="text-xs text-text-muted mt-2">{isArbiter ? 'You are the arbiter.' : 'You are the merchant (graceful exit).'}</p>
                </div>
              )}

              {escrow.status === 1 && (
                <div className="border-t border-border-default pt-4 text-center text-sm text-green-400">
                  <CheckCircle className="inline w-4 h-4 mr-1" /> All 4 milestones claimed.
                </div>
              )}
            </Card>
          )}
        </motion.div>
      )}
    </div>
  );
}
