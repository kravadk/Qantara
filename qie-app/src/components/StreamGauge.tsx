import { useEffect, useState } from 'react';
import { formatEther } from 'viem';

interface StreamGaugeProps {
  deposited: bigint;
  withdrawn: bigint;
  startsAt: number;
  endsAt: number;
  amountPerSec: bigint;
  cancelled?: boolean;
  symbol?: string;
}

/**
 * Live progress gauge for a stream. Updates ~60fps via requestAnimationFrame.
 */
export function StreamGauge({
  deposited,
  withdrawn,
  startsAt,
  endsAt,
  amountPerSec,
  cancelled,
  symbol = 'QIE',
}: StreamGaugeProps) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      setNow(Math.floor(Date.now() / 1000));
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, []);

  const t = Math.min(Math.max(now, startsAt), endsAt);
  const accrued = BigInt(t - startsAt) * amountPerSec;
  const accruedClamped = accrued > deposited ? deposited : accrued;
  const withdrawable = accruedClamped > withdrawn ? accruedClamped - withdrawn : 0n;
  const pct = deposited > 0n ? Number((accruedClamped * 10000n) / deposited) / 100 : 0;

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
      <div className="mb-2 flex items-center justify-between text-xs text-slate-400">
        <span>{cancelled ? '⊘ cancelled' : 'streaming'}</span>
        <span>{pct.toFixed(2)}%</span>
      </div>
      <div className="mb-3 h-2 overflow-hidden rounded-full bg-slate-800">
        <div
          className={`h-full transition-[width] duration-150 ease-linear ${cancelled ? 'bg-slate-500' : 'bg-emerald-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        <div>
          <div className="text-slate-500">accrued</div>
          <div className="font-mono text-slate-100">{formatEther(accruedClamped).slice(0, 10)}</div>
        </div>
        <div>
          <div className="text-slate-500">claimable</div>
          <div className="font-mono text-emerald-400">{formatEther(withdrawable).slice(0, 10)}</div>
        </div>
        <div>
          <div className="text-slate-500">total</div>
          <div className="font-mono text-slate-100">{formatEther(deposited).slice(0, 10)}</div>
        </div>
      </div>
      <div className="mt-2 text-center text-[10px] text-slate-500">
        {formatEther(amountPerSec).slice(0, 12)} {symbol}/sec
      </div>
    </div>
  );
}
