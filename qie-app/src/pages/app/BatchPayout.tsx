import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Users2, Plus, Wallet, Trash2, Upload, Copy, ExternalLink, Loader2, CheckCircle, RotateCcw } from 'lucide-react';
import { useAccount, usePublicClient, useWriteContract } from 'wagmi';
import { formatEther, formatUnits, parseEther, parseUnits, toHex, zeroAddress, isAddress, type Hex } from 'viem';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { useToastStore } from '../../components/ToastContainer';
import { batchPayoutAbi, erc20ApproveAbi } from '../../lib/qantaraAbi';
import { BATCH_PAYOUT_ADDRESS, QUSDC_ADDRESS } from '../../lib/dealRoom';
import { qieMainnet } from '../../config/wagmi';

type Token = 'QIE' | 'QUSDC';

interface BatchView {
  funder: `0x${string}`;
  token: `0x${string}`;
  totalAmount: bigint;
  claimedAmount: bigint;
  createdAt: number;
  expiresAt: number;
  reclaimed: boolean;
}

interface Recipient { address: string; amount: string; }

const MAX_RECIPIENTS = 100;

function tokenSymbol(addr: string): Token {
  return addr.toLowerCase() === zeroAddress ? 'QIE' : 'QUSDC';
}

function formatAmount(value: bigint, sym: Token): string {
  return sym === 'QIE' ? formatEther(value) : formatUnits(value, 6);
}

export function BatchPayout() {
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: qieMainnet.id });
  const { writeContractAsync } = useWriteContract();
  const { addToast } = useToastStore();

  const [mode, setMode] = useState<'create' | 'manage'>('create');
  const [loadedId, setLoadedId] = useState<Hex | ''>('');
  const [batch, setBatch] = useState<BatchView | null>(null);
  const [myEntitlement, setMyEntitlement] = useState<bigint>(0n);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [createToken, setCreateToken] = useState<Token>('QIE');
  const [recipients, setRecipients] = useState<Recipient[]>([{ address: '', amount: '' }]);
  const [createExpiresAt, setCreateExpiresAt] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const contractReady = Boolean(BATCH_PAYOUT_ADDRESS);

  const loadBatch = async (id: Hex) => {
    if (!publicClient) return;
    setIsLoading(true);
    setLoadError(null);
    try {
      const b = (await (publicClient as any).readContract({
        address: BATCH_PAYOUT_ADDRESS!,
        abi: batchPayoutAbi,
        functionName: 'getBatch',
        args: [id],
      })) as BatchView;
      setBatch(b);
      if (address) {
        const ent = (await (publicClient as any).readContract({
          address: BATCH_PAYOUT_ADDRESS!,
          abi: batchPayoutAbi,
          functionName: 'entitlementOf',
          args: [id, address],
        })) as bigint;
        setMyEntitlement(ent);
      } else {
        setMyEntitlement(0n);
      }
    } catch (err) {
      const message = (err as any)?.shortMessage ?? (err as Error).message;
      addToast('error', `Failed to load batch: ${message}`);
      setLoadError(message);
      setBatch(null);
      setMyEntitlement(0n);
    } finally {
      setIsLoading(false);
    }
  };

  const idReady = /^0x[a-fA-F0-9]{64}$/.test(loadedId);

  useEffect(() => {
    if (mode !== 'manage') return;
    if (!loadedId || !idReady) {
      setBatch(null);
      setLoadError(null);
      setMyEntitlement(0n);
      return;
    }
    void loadBatch(loadedId as Hex);
  }, [loadedId, mode, address, idReady]);

  const tokenSym = batch ? tokenSymbol(batch.token) : createToken;

  const updateRecipient = (idx: number, patch: Partial<Recipient>) => {
    setRecipients((rs) => rs.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const addRow = () => {
    if (recipients.length >= MAX_RECIPIENTS) return addToast('warning', `Max ${MAX_RECIPIENTS} recipients`);
    setRecipients((rs) => [...rs, { address: '', amount: '' }]);
  };

  const removeRow = (idx: number) => setRecipients((rs) => rs.length === 1 ? rs : rs.filter((_, i) => i !== idx));

  const handleCsv = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = (event.target?.result ?? '') as string;
      const lines = text.split(/\r?\n/).filter((l) => l.trim());
      const parsed: Recipient[] = [];
      const start = lines[0]?.toLowerCase().includes('address') ? 1 : 0;
      for (let i = start; i < lines.length && parsed.length < MAX_RECIPIENTS; i++) {
        const [addr, amt] = lines[i].split(/[,;\t]/).map((s) => s.trim());
        if (addr?.startsWith('0x') && amt && /^\d+(\.\d+)?$/.test(amt)) {
          parsed.push({ address: addr, amount: amt });
        }
      }
      if (parsed.length > 0) {
        setRecipients(parsed);
        addToast('success', `${parsed.length} recipients imported from CSV`);
      } else {
        addToast('error', 'No valid rows found (expected: address,amount per line)');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const totalAmount = useMemo(() => {
    let sum = 0;
    for (const r of recipients) {
      const v = parseFloat(r.amount);
      if (Number.isFinite(v)) sum += v;
    }
    return sum;
  }, [recipients]);

  const validRows = useMemo(() => recipients.filter((r) => isAddress(r.address) && /^\d+(\.\d+)?$/.test(r.amount) && parseFloat(r.amount) > 0), [recipients]);
  const invalidCount = recipients.length - validRows.length;

  const handleCreate = async () => {
    if (!address) return addToast('warning', 'Connect wallet first');
    if (!contractReady) return addToast('error', 'BatchPayout not configured');
    if (validRows.length === 0) return addToast('error', 'No valid recipients');
    if (invalidCount > 0) return addToast('error', `${invalidCount} row${invalidCount === 1 ? '' : 's'} invalid — fix or remove`);

    try {
      const saltBytes = crypto.getRandomValues(new Uint8Array(32));
      const salt = toHex(saltBytes);
      const tokenAddr = createToken === 'QIE' ? zeroAddress : (QUSDC_ADDRESS as `0x${string}`);
      const expiresAtSec = createExpiresAt ? Math.floor(new Date(createExpiresAt).getTime() / 1000) : 0;

      const addrs = validRows.map((r) => r.address as `0x${string}`);
      const amounts = validRows.map((r) => createToken === 'QIE' ? parseEther(r.amount) : parseUnits(r.amount, 6));
      const total = amounts.reduce((a, b) => a + b, 0n);

      if (createToken === 'QUSDC') {
        if (!QUSDC_ADDRESS) return addToast('error', 'QUSDC address not configured');
        const allowance = (await (publicClient as any).readContract({
          address: QUSDC_ADDRESS,
          abi: erc20ApproveAbi,
          functionName: 'allowance',
          args: [address, BATCH_PAYOUT_ADDRESS!],
        })) as bigint;
        if (allowance < total) {
          addToast('info', 'Step 1/2: approve QUSDC');
          const ap = await writeContractAsync({
            account: address,
            chain: qieMainnet,
            address: QUSDC_ADDRESS,
            abi: erc20ApproveAbi,
            functionName: 'approve',
            args: [BATCH_PAYOUT_ADDRESS!, total],
          } as any);
          await publicClient!.waitForTransactionReceipt({ hash: ap });
        }
      }

      addToast('info', createToken === 'QIE' ? 'Confirm createBatch on mainnet' : 'Step 2/2: confirm createBatch');
      const tx = await writeContractAsync({
        account: address,
        chain: qieMainnet,
        address: BATCH_PAYOUT_ADDRESS!,
        abi: batchPayoutAbi,
        functionName: 'createBatch',
        args: [tokenAddr, addrs, amounts, BigInt(expiresAtSec), salt as Hex],
        value: createToken === 'QIE' ? total : 0n,
      } as any);
      const r = await publicClient!.waitForTransactionReceipt({ hash: tx });
      addToast('success', `Batch created in block ${r.blockNumber}`);

      const id = (await (publicClient as any).readContract({
        address: BATCH_PAYOUT_ADDRESS!,
        abi: batchPayoutAbi,
        functionName: 'computeBatchId',
        args: [address, salt as Hex],
      })) as Hex;
      setLoadedId(id);
      setMode('manage');
      await loadBatch(id);
    } catch (err) {
      addToast('error', (err as any)?.shortMessage ?? (err as Error).message);
    }
  };

  const runWrite = async (functionName: 'claim' | 'reclaim', label: string) => {
    if (!address || !batch) return;
    try {
      addToast('info', `Confirm ${label}`);
      const tx = await writeContractAsync({
        account: address,
        chain: qieMainnet,
        address: BATCH_PAYOUT_ADDRESS!,
        abi: batchPayoutAbi,
        functionName,
        args: [loadedId as Hex],
      } as any);
      await publicClient!.waitForTransactionReceipt({ hash: tx });
      addToast('success', `${label} confirmed`);
      await loadBatch(loadedId as Hex);
    } catch (err) {
      addToast('error', (err as any)?.shortMessage ?? (err as Error).message);
    }
  };

  const isFunder = batch && address && batch.funder.toLowerCase() === address.toLowerCase();
  const isExpired = batch && batch.expiresAt > 0 && Date.now() / 1000 > batch.expiresAt;
  const leftoverAmount = batch ? batch.totalAmount - batch.claimedAmount : 0n;
  const progressPct = batch && batch.totalAmount > 0n ? Number((batch.claimedAmount * 1000n) / batch.totalAmount) / 10 : 0;
  const batchStatus = batch?.reclaimed ? 'Reclaimed' : batch && batch.claimedAmount >= batch.totalAmount ? 'Complete' : isExpired ? 'Expired' : 'Open';

  const explorerUrl = qieMainnet.blockExplorers.default.url;

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <Users2 className="w-8 h-8 text-primary" />
          <h1 className="text-4xl font-bold text-white tracking-tight">Batch Payout</h1>
        </div>
        <p className="text-text-muted">Batch state is read from the payout contract on QIE Mainnet. Recipients claim from contract entitlements after the funding transaction is confirmed.</p>
      </div>

      {!contractReady && (
        <Card className="p-4 border border-yellow-500/30 bg-yellow-500/5 text-yellow-300 text-sm">
          VITE_BATCH_PAYOUT_ADDRESS is not configured.
        </Card>
      )}

      <div className="flex gap-2 border-b border-border-default">
        <button onClick={() => setMode('create')} className={`px-4 py-2 text-sm font-bold border-b-2 transition-colors ${mode === 'create' ? 'border-primary text-white' : 'border-transparent text-text-muted hover:text-white'}`}>
          <Plus className="inline w-4 h-4 mr-1" /> Create
        </button>
        <button onClick={() => setMode('manage')} className={`px-4 py-2 text-sm font-bold border-b-2 transition-colors ${mode === 'manage' ? 'border-primary text-white' : 'border-transparent text-text-muted hover:text-white'}`}>
          <Wallet className="inline w-4 h-4 mr-1" /> Open / Claim
        </button>
      </div>

      {mode === 'create' && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="p-6 space-y-4">
            <div className="flex gap-2 items-center justify-between">
              <div>
                <label className="text-xs font-bold uppercase tracking-widest text-text-muted">Token</label>
                <div className="flex gap-2 mt-2">
                  {(['QIE', 'QUSDC'] as Token[]).map((t) => (
                    <button key={t} onClick={() => setCreateToken(t)} className={`px-4 py-2 text-sm font-bold rounded border ${createToken === t ? 'border-primary bg-primary/10 text-primary' : 'border-border-default text-text-muted hover:text-white'}`}>{t}</button>
                  ))}
                </div>
              </div>
              <div>
                <input ref={fileRef} type="file" accept=".csv,.txt" onChange={handleCsv} className="hidden" />
                <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
                  <Upload className="w-4 h-4 mr-1" /> Import CSV
                </Button>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-bold uppercase tracking-widest text-text-muted">Recipients ({recipients.length}/{MAX_RECIPIENTS})</label>
                <Button variant="ghost" size="sm" onClick={addRow}>+ Add row</Button>
              </div>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {recipients.map((r, idx) => {
                  const addrValid = !r.address || isAddress(r.address);
                  const amtValid = !r.amount || (/^\d+(\.\d+)?$/.test(r.amount) && parseFloat(r.amount) > 0);
                  return (
                    <div key={idx} className="flex gap-2 items-start">
                      <input
                        type="text"
                        placeholder="0x recipient address"
                        value={r.address}
                        onChange={(e) => updateRecipient(idx, { address: e.target.value.trim() })}
                        className={`flex-1 px-3 py-2 bg-surface-1 border rounded text-white font-mono text-xs ${addrValid ? 'border-border-default' : 'border-red-500/50'}`}
                      />
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder="amount"
                        value={r.amount}
                        onChange={(e) => updateRecipient(idx, { amount: e.target.value })}
                        className={`w-32 px-3 py-2 bg-surface-1 border rounded text-white ${amtValid ? 'border-border-default' : 'border-red-500/50'}`}
                      />
                      <button onClick={() => removeRow(idx)} className="p-2 text-text-muted hover:text-red-400" disabled={recipients.length === 1}>
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="text-xs font-bold uppercase tracking-widest text-text-muted">Expires (optional, funder can reclaim leftovers after)</label>
              <input type="datetime-local" value={createExpiresAt} onChange={(e) => setCreateExpiresAt(e.target.value)} className="w-full mt-2 px-3 py-2 bg-surface-1 border border-border-default rounded text-white" />
            </div>

            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm flex items-center justify-between">
              <span className="text-text-muted">Total funding required:</span>
              <span className="font-bold text-primary">{totalAmount.toFixed(6)} {createToken} ({validRows.length} valid recipient{validRows.length === 1 ? '' : 's'})</span>
            </div>

            <Button onClick={handleCreate} disabled={!contractReady || !address || validRows.length === 0} className="w-full">
              <Plus className="w-4 h-4 mr-1" /> Create Batch + Fund
            </Button>
          </Card>
        </motion.div>
      )}

      {mode === 'manage' && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <Card className="p-6 space-y-3">
            <label className="text-xs font-bold uppercase tracking-widest text-text-muted">Batch id</label>
            <input type="text" placeholder="0x... (64 hex)" value={loadedId} onChange={(e) => setLoadedId(e.target.value.trim() as Hex)} className="w-full px-3 py-2 bg-surface-1 border border-border-default rounded text-white font-mono text-xs" />
            <p className="text-xs text-text-muted">Enter a batch id returned by the contract-backed create flow. Claim and reclaim actions refresh from contract reads.</p>
          </Card>

          {loadedId && !idReady && (
            <Card className="p-4 border border-yellow-500/30 bg-yellow-500/5 text-yellow-200 text-sm">
              Use a full 32-byte batch id in 0x-prefixed hex format.
            </Card>
          )}

          {isLoading && (
            <div className="text-center text-text-muted text-sm py-4"><Loader2 className="inline w-4 h-4 mr-2 animate-spin" /> Loading from contract...</div>
          )}

          {loadError && !isLoading && (
            <Card className="p-4 border border-red-500/30 bg-red-500/5 text-red-200 text-sm">
              Contract read failed: {loadError}
            </Card>
          )}

          {!loadedId && !isLoading && (
            <Card className="p-6 text-center text-sm text-text-muted">
              Open an existing payout batch by entering its contract id, or create a funded batch from the Create tab.
            </Card>
          )}

          {batch && (
            <Card className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-text-muted uppercase tracking-widest">Status</div>
                  <div className="text-xl font-bold text-primary">
                    {batchStatus}
                  </div>
                  <div className="mt-1 text-xs text-text-muted">Source: contract read on QIE Mainnet</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-text-muted uppercase tracking-widest">Claimed</div>
                  <div className="text-2xl font-bold text-white">
                    {formatAmount(batch.claimedAmount, tokenSym)} <span className="text-sm text-text-muted">{tokenSym}</span>
                  </div>
                  <div className="text-xs text-text-muted">of {formatAmount(batch.totalAmount, tokenSym)} {tokenSym} ({progressPct}%)</div>
                </div>
              </div>

              <div className="h-2 rounded overflow-hidden bg-surface-2">
                <div className="h-full bg-primary transition-all" style={{ width: `${progressPct}%` }} />
              </div>

              <div className="text-xs space-y-1 font-mono">
                <div><span className="text-text-muted">Funder: </span><a href={`${explorerUrl}/address/${batch.funder}`} target="_blank" rel="noreferrer" className="hover:text-primary inline-flex items-center gap-1">{batch.funder.slice(0, 10)}...{batch.funder.slice(-6)} <ExternalLink className="w-3 h-3" /></a></div>
                <div><span className="text-text-muted">Created: </span>{new Date(batch.createdAt * 1000).toLocaleString()}</div>
                {batch.expiresAt > 0 && <div><span className="text-text-muted">Expires: </span>{new Date(batch.expiresAt * 1000).toLocaleString()}</div>}
                <div className="flex items-center gap-2"><span className="text-text-muted">Id: </span>{loadedId.slice(0, 14)}...<button onClick={() => { void navigator.clipboard.writeText(loadedId); addToast('success', 'Copied'); }} className="text-primary hover:text-white"><Copy className="w-3 h-3" /></button></div>
                <div><span className="text-text-muted">Your entitlement: </span><span className="font-bold text-white">{formatAmount(myEntitlement, tokenSym)} {tokenSym}</span></div>
              </div>

              {myEntitlement > 0n && !batch.reclaimed && (
                <div className="border-t border-border-default pt-4">
                  <Button onClick={() => runWrite('claim', `Claim ${formatAmount(myEntitlement, tokenSym)} ${tokenSym}`)} className="w-full" disabled={Boolean(isExpired)}>
                    Claim {formatAmount(myEntitlement, tokenSym)} {tokenSym}
                  </Button>
                  {isExpired && <p className="mt-2 text-xs text-yellow-300">This batch is expired. Ask the funder to reclaim any leftover contract balance.</p>}
                </div>
              )}

              {address && myEntitlement === 0n && (
                <p className="text-xs text-text-muted text-center">Your wallet is not in this batch's recipient list.</p>
              )}

              {!address && (
                <p className="text-xs text-text-muted text-center">Connect the recipient wallet to read its contract entitlement.</p>
              )}

              {isFunder && isExpired && !batch.reclaimed && leftoverAmount > 0n && (
                <div className="border-t border-border-default pt-4">
                  <Button variant="secondary" onClick={() => runWrite('reclaim', 'Reclaim leftover')} className="w-full">
                    <RotateCcw className="w-4 h-4 mr-1" /> Reclaim leftover ({formatAmount(leftoverAmount, tokenSym)} {tokenSym})
                  </Button>
                </div>
              )}

              {batch.reclaimed && (
                <div className="border-t border-border-default pt-4 text-center text-sm text-text-muted">
                  <CheckCircle className="inline w-4 h-4 mr-1" /> Leftover already reclaimed by funder.
                </div>
              )}
            </Card>
          )}
        </motion.div>
      )}
    </div>
  );
}
