import { useEffect, useMemo, useRef, useState } from 'react';
import { isAddress } from 'viem';
import { Check, Loader2, X } from 'lucide-react';
import { resolveHandle, type ResolveResult } from '../lib/resolver';

interface UsernameInputProps {
  /** Current raw text the user typed (handle or address). */
  value: string;
  /** Called on every keystroke with the raw text. */
  onChange: (raw: string) => void;
  /** Called whenever the resolved address changes (null = unresolved). */
  onResolved?: (result: ResolveResult | null) => void;
  label?: string;
  placeholder?: string;
  hasError?: boolean;
  disabled?: boolean;
}

const SOURCE_BADGE: Record<ResolveResult['source'], { label: string; cls: string }> = {
  address: { label: '0x', cls: 'bg-slate-700/40 text-slate-300' },
  ens: { label: 'ENS', cls: 'bg-indigo-500/20 text-indigo-300' },
  lens: { label: 'Lens', cls: 'bg-emerald-500/20 text-emerald-300' },
  farcaster: { label: 'Farcaster', cls: 'bg-purple-500/20 text-purple-300' },
  telegram: { label: 'Telegram', cls: 'bg-sky-500/20 text-sky-300' },
};

/**
 * Combined address / username input with live resolution against the backend.
 * Accepts 0x, .eth, .lens, @farcaster, @telegram. Shows a source badge + avatar
 * when resolution succeeds. Debounced 350ms; cached client-side.
 */
export function UsernameInput({
  value,
  onChange,
  onResolved,
  label = 'Recipient',
  placeholder = 'vitalik.eth, @dima, or 0x…',
  hasError,
  disabled,
}: UsernameInputProps) {
  const [status, setStatus] = useState<'idle' | 'pending' | 'ok' | 'miss'>('idle');
  const [resolved, setResolved] = useState<ResolveResult | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastQueryRef = useRef<string>('');

  const trimmed = value.trim();
  const looksLikeRawAddress = useMemo(() => isAddress(trimmed), [trimmed]);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!trimmed) {
      setStatus('idle');
      setResolved(null);
      onResolved?.(null);
      return;
    }
    if (looksLikeRawAddress) {
      const r: ResolveResult = {
        address: trimmed as `0x${string}`,
        source: 'address',
        displayName: trimmed,
      };
      setStatus('ok');
      setResolved(r);
      onResolved?.(r);
      return;
    }
    setStatus('pending');
    timerRef.current = setTimeout(async () => {
      lastQueryRef.current = trimmed;
      const res = await resolveHandle(trimmed);
      if (lastQueryRef.current !== trimmed) return;
      if (res.ok && res.result) {
        setStatus('ok');
        setResolved(res.result);
        onResolved?.(res.result);
      } else {
        setStatus('miss');
        setResolved(null);
        onResolved?.(null);
      }
    }, 350);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmed, looksLikeRawAddress]);

  const ringCls =
    hasError || status === 'miss'
      ? 'ring-red-500/50 border-red-500/40'
      : status === 'ok'
        ? 'ring-emerald-500/40 border-emerald-500/30'
        : 'ring-slate-600/40 border-slate-700';

  return (
    <div className="flex flex-col gap-2">
      {label ? (
        <label className="text-xs font-medium uppercase tracking-wider text-slate-400">
          {label}
        </label>
      ) : null}
      <div
        className={`relative flex items-center rounded-md border bg-slate-900/60 px-3 py-2 ring-1 ${ringCls}`}
      >
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          spellCheck={false}
          autoComplete="off"
          className="flex-1 bg-transparent text-sm text-slate-100 placeholder:text-slate-500 outline-none disabled:opacity-50"
        />
        <div className="ml-2 flex items-center gap-2">
          {status === 'pending' ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" /> : null}
          {status === 'ok' && resolved ? (
            <>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${SOURCE_BADGE[resolved.source].cls}`}
              >
                {SOURCE_BADGE[resolved.source].label}
              </span>
              {resolved.avatar ? (
                <img
                  src={resolved.avatar}
                  alt=""
                  className="h-5 w-5 rounded-full border border-slate-700 object-cover"
                  onError={(e) => (e.currentTarget.style.display = 'none')}
                />
              ) : null}
              <Check className="h-4 w-4 text-emerald-400" />
            </>
          ) : null}
          {status === 'miss' ? <X className="h-4 w-4 text-red-400" /> : null}
        </div>
      </div>
      {status === 'ok' && resolved && resolved.source !== 'address' ? (
        <div className="text-[11px] text-slate-500">
          → <code className="text-slate-400">{resolved.address}</code>
        </div>
      ) : null}
      {status === 'miss' ? (
        <div className="text-[11px] text-red-400/80">Could not resolve "{trimmed}".</div>
      ) : null}
    </div>
  );
}
