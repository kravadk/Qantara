import { useMemo, useState } from 'react';
import { useAccount, useReadContract, useWriteContract } from 'wagmi';
import { keccak256, toHex, parseEther, type Address, type Hex } from 'viem';
import { Plus, Trash2, Send } from 'lucide-react';
import { UsernameInput } from '../../components/UsernameInput';
import { qantaraSplitsAbi, QANTARA_SPLITS_ADDRESS } from '../../lib/splitsAbi';
import { qieMainnet } from '../../config/wagmi';
import type { ResolveResult } from '../../lib/resolver';

interface Row {
  raw: string;
  resolved: Address | null;
  bps: string;
}

export function Splits() {
  const { address } = useAccount();
  const { writeContract, isPending, error } = useWriteContract();
  const [rows, setRows] = useState<Row[]>([
    { raw: '', resolved: null, bps: '5000' },
    { raw: '', resolved: null, bps: '5000' },
  ]);
  const [salt] = useState<Hex>(() => keccak256(toHex(Date.now().toString())) as Hex);
  const [distributeAmount, setDistributeAmount] = useState('');

  const valid = useMemo(() => {
    if (rows.some((r) => !r.resolved)) return false;
    const sum = rows.reduce((acc, r) => acc + (parseInt(r.bps, 10) || 0), 0);
    return sum === 10000;
  }, [rows]);

  const recipients = rows.map((r) => r.resolved).filter(Boolean) as Address[];
  const sharesBps = rows.map((r) => parseInt(r.bps, 10) || 0);

  // Derive splitId via the on-chain helper (mirrors the Solidity computeSplitId).
  const { data: splitId } = useReadContract({
    address: QANTARA_SPLITS_ADDRESS,
    abi: qantaraSplitsAbi,
    functionName: 'computeSplitId',
    args: valid ? [recipients, sharesBps, salt] : undefined,
    query: { enabled: valid },
  });

  function update(i: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function add() {
    setRows((rs) => [...rs, { raw: '', resolved: null, bps: '0' }]);
  }
  function remove(i: number) {
    setRows((rs) => (rs.length > 1 ? rs.filter((_, idx) => idx !== i) : rs));
  }

  function create() {
    if (!address || !valid) return;
    writeContract({
      address: QANTARA_SPLITS_ADDRESS,
      abi: qantaraSplitsAbi,
      functionName: 'createSplit',
      args: [recipients, sharesBps, address as Address, salt],
      account: address,
      chain: qieMainnet,
    });
  }

  function distribute() {
    if (!address || !distributeAmount || !splitId) return;
    writeContract({
      address: QANTARA_SPLITS_ADDRESS,
      abi: qantaraSplitsAbi,
      functionName: 'distributeNative',
      args: [splitId as Hex],
      account: address,
      chain: qieMainnet,
      value: parseEther(distributeAmount),
    });
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <h1 className="text-xl font-semibold text-slate-100">Splits</h1>
      <p className="text-sm text-slate-400">
        Create a revenue-share recipe. Up to 50 recipients, shares must sum to 100% (10000 bps).
      </p>

      <div className="space-y-3 rounded-xl border border-slate-700 bg-slate-900/60 p-4">
        {rows.map((r, i) => (
          <div key={i} className="flex items-end gap-2">
            <div className="flex-1">
              <UsernameInput
                value={r.raw}
                onChange={(v) => update(i, { raw: v })}
                onResolved={(res: ResolveResult | null) => update(i, { resolved: res?.address ?? null })}
                label={i === 0 ? 'Recipient' : ''}
                placeholder="vitalik.eth or 0x…"
              />
            </div>
            <div className="w-24">
              {i === 0 ? (
                <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-slate-400">
                  bps
                </label>
              ) : null}
              <input
                type="number"
                inputMode="numeric"
                value={r.bps}
                onChange={(e) => update(i, { bps: e.target.value })}
                className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-2 text-right text-sm text-slate-100"
              />
            </div>
            <button
              type="button"
              onClick={() => remove(i)}
              className="p-2 text-slate-500 hover:text-red-400"
              disabled={rows.length === 1}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={add}
          className="flex items-center gap-1 rounded-md border border-slate-700 px-3 py-1 text-xs text-slate-300 hover:bg-slate-800"
        >
          <Plus className="h-3 w-3" /> Add row
        </button>
        <div className="text-xs text-slate-500">
          Sum: {sharesBps.reduce((a, b) => a + b, 0)} / 10000 bps
        </div>
        <button
          type="button"
          onClick={create}
          disabled={!valid || !address || isPending}
          className="w-full rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {isPending ? 'Creating…' : 'Create split'}
        </button>
        {splitId ? (
          <div className="text-[10px] text-slate-500">
            splitId: <code className="text-slate-400">{(splitId as string).slice(0, 18)}…</code>
          </div>
        ) : null}
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
        <h2 className="mb-2 text-sm font-semibold text-slate-100">Distribute native QIE</h2>
        <div className="flex gap-2">
          <input
            type="text"
            inputMode="decimal"
            placeholder="amount in QIE"
            value={distributeAmount}
            onChange={(e) => setDistributeAmount(e.target.value)}
            className="flex-1 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
          />
          <button
            type="button"
            onClick={distribute}
            disabled={!address || !distributeAmount || !splitId || isPending}
            className="flex items-center gap-1 rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            <Send className="h-4 w-4" /> Distribute
          </button>
        </div>
      </div>

      {error ? <div className="text-xs text-red-400">{error.message.slice(0, 200)}</div> : null}
    </div>
  );
}
