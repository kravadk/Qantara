import { useState } from 'react';
import { useAccount, useReadContract, useWriteContract } from 'wagmi';
import { parseEther, zeroAddress, type Address } from 'viem';
import { Send } from 'lucide-react';
import { UsernameInput } from '../../components/UsernameInput';
import { StreamGauge } from '../../components/StreamGauge';
import { qantaraStreamsAbi, QANTARA_STREAMS_ADDRESS } from '../../lib/streamsAbi';
import { qieMainnet } from '../../config/wagmi';
import type { ResolveResult } from '../../lib/resolver';

export function Streams() {
  const { address } = useAccount();
  const { writeContract, isPending, error } = useWriteContract();

  const [recipientRaw, setRecipientRaw] = useState('');
  const [recipient, setRecipient] = useState<ResolveResult | null>(null);
  const [perSec, setPerSec] = useState('0.0001');
  const [durationMin, setDurationMin] = useState('10');
  const [viewId, setViewId] = useState('1');

  function create() {
    if (!address || !recipient) return;
    const amountPerSec = parseEther(perSec || '0');
    const dur = parseInt(durationMin, 10) || 0;
    const now = Math.floor(Date.now() / 1000);
    const startsAt = now + 5;
    const endsAt = startsAt + dur * 60;
    const total = amountPerSec * BigInt(endsAt - startsAt);
    writeContract({
      address: QANTARA_STREAMS_ADDRESS,
      abi: qantaraStreamsAbi,
      functionName: 'createStream',
      args: [recipient.address, zeroAddress as Address, amountPerSec, BigInt(startsAt), BigInt(endsAt)],
      account: address,
      chain: qieMainnet,
      value: total,
    });
  }

  const { data: streamData } = useReadContract({
    address: QANTARA_STREAMS_ADDRESS,
    abi: qantaraStreamsAbi,
    functionName: 'streams',
    args: viewId ? [BigInt(viewId || '0')] : undefined,
    query: { enabled: !!viewId, refetchInterval: 5000 },
  });

  const tuple = streamData as unknown as readonly [Address, Address, Address, bigint, bigint, bigint, bigint, bigint, boolean] | undefined;

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <h1 className="text-xl font-semibold text-slate-100">Streams</h1>
      <p className="text-sm text-slate-400">
        Per-second native QIE streams. Payer prefunds, recipient withdraws live.
      </p>

      <div className="space-y-3 rounded-xl border border-slate-700 bg-slate-900/60 p-4">
        <UsernameInput
          value={recipientRaw}
          onChange={setRecipientRaw}
          onResolved={setRecipient}
          label="Recipient"
        />
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs uppercase tracking-wider text-slate-400">QIE / sec</label>
            <input
              type="text"
              inputMode="decimal"
              value={perSec}
              onChange={(e) => setPerSec(e.target.value)}
              className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
            />
          </div>
          <div>
            <label className="text-xs uppercase tracking-wider text-slate-400">Duration (min)</label>
            <input
              type="number"
              value={durationMin}
              onChange={(e) => setDurationMin(e.target.value)}
              className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
            />
          </div>
        </div>
        <button
          type="button"
          onClick={create}
          disabled={!recipient || !address || isPending}
          className="flex w-full items-center justify-center gap-1 rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          <Send className="h-4 w-4" /> {isPending ? 'Creating…' : 'Start stream'}
        </button>
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
        <div className="mb-3 flex items-center gap-2">
          <label className="text-xs uppercase tracking-wider text-slate-400">Stream ID</label>
          <input
            type="number"
            value={viewId}
            onChange={(e) => setViewId(e.target.value)}
            className="w-20 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100"
          />
        </div>
        {tuple ? (
          <StreamGauge
            deposited={tuple[6]}
            withdrawn={tuple[7]}
            startsAt={Number(tuple[4])}
            endsAt={Number(tuple[5])}
            amountPerSec={tuple[3]}
            cancelled={tuple[8]}
          />
        ) : (
          <div className="text-center text-xs text-slate-500">No stream loaded.</div>
        )}
        {tuple && address && tuple[1].toLowerCase() === address.toLowerCase() ? (
          <button
            type="button"
            onClick={() =>
              writeContract({
                address: QANTARA_STREAMS_ADDRESS,
                abi: qantaraStreamsAbi,
                functionName: 'withdraw',
                args: [BigInt(viewId)],
                account: address,
                chain: qieMainnet,
              })
            }
            className="mt-3 w-full rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
          >
            Withdraw
          </button>
        ) : null}
      </div>

      {error ? <div className="text-xs text-red-400">{error.message.slice(0, 200)}</div> : null}
    </div>
  );
}
