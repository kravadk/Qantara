import { useId, useState } from 'react';
import { ArrowRightLeft, ExternalLink, ShoppingCart } from 'lucide-react';
import { useQiePrice } from '../hooks/useQiePrice';
import { QIE_EXCHANGES, QIE_LINKS } from '../lib/qieResources';

interface AmountInputProps {
  /** Amount in selected token as a decimal string. */
  value: string;
  /** Called whenever the selected-token amount changes. */
  onChange: (tokenValue: string) => void;
  token?: 'QIE' | 'QUSDC';
  label?: string;
  placeholder?: string;
  hasError?: boolean;
}

export function AmountInput({ value, onChange, token = 'QIE', label = 'Amount', placeholder = '0.00', hasError }: AmountInputProps) {
  const inputId = useId();
  const helpId = useId();
  const [inputMode, setInputMode] = useState<'QIE' | 'USD'>('QIE');
  const [usdInput, setUsdInput] = useState('');
  const { price, loading, qieToUsd } = useQiePrice();

  const handleQieChange = (val: string) => {
    onChange(val);
    if (price && val) {
      setUsdInput((parseFloat(val) * price).toFixed(2));
    } else {
      setUsdInput('');
    }
  };

  const handleUsdChange = (val: string) => {
    setUsdInput(val);
    if (price && val) {
      const qie = parseFloat(val) / price;
      onChange(qie.toFixed(8).replace(/\.?0+$/, ''));
    } else {
      onChange('');
    }
  };

  const toggleMode = () => {
    if (inputMode === 'QIE') {
      setInputMode('USD');
      if (value && price) {
        setUsdInput((parseFloat(value) * price).toFixed(2));
      }
    } else {
      setInputMode('QIE');
    }
  };

  const qieValue = parseFloat(value || '0');
  const usdValue = qieToUsd(qieValue);
  const primaryExchange = QIE_EXCHANGES[0];

  if (token === 'QUSDC') {
    return (
      <div className="space-y-2">
        <label htmlFor={inputId} className="text-xs font-bold text-text-muted uppercase tracking-widest">
          {label}
        </label>
        <div className="relative">
          <input
            type="number"
            placeholder={placeholder}
            min="0.01"
            step="0.01"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            id={inputId}
            aria-describedby={helpId}
            aria-invalid={hasError || undefined}
            className={`w-full h-14 px-6 pr-24 bg-surface-2 border ${hasError ? 'border-red-500' : 'border-border-default'} rounded-2xl text-white focus:border-primary/40 focus:outline-none transition-colors`}
          />
          <div className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-text-muted">
            QUSDC
          </div>
        </div>
        <div className="flex items-center justify-between px-1">
          <p id={helpId} className="text-xs text-text-muted">Stablecoin amount paid as ERC-20 QUSDC.</p>
          {value && <p className="text-xs text-green-400">≈ ${Number(value || 0).toFixed(2)} USD</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <label htmlFor={inputId} className="text-xs font-bold text-text-muted uppercase tracking-widest">
        {label}
      </label>

      <div className="relative">
        {inputMode === 'QIE' ? (
          <input
            type="number"
            placeholder={placeholder}
            min="0.000001"
            step="0.001"
            value={value}
            onChange={(e) => handleQieChange(e.target.value)}
            id={inputId}
            aria-describedby={helpId}
            aria-invalid={hasError || undefined}
            className={`w-full h-14 px-6 pr-24 bg-surface-2 border ${hasError ? 'border-red-500' : 'border-border-default'} rounded-2xl text-white focus:border-primary/40 focus:outline-none transition-colors`}
          />
        ) : (
          <input
            type="number"
            placeholder="0.00"
            min="0.01"
            step="0.01"
            value={usdInput}
            onChange={(e) => handleUsdChange(e.target.value)}
            id={inputId}
            aria-describedby={helpId}
            aria-invalid={hasError || undefined}
            className={`w-full h-14 px-6 pr-24 bg-surface-2 border ${hasError ? 'border-red-500' : 'border-border-default'} rounded-2xl text-white focus:border-primary/40 focus:outline-none transition-colors`}
          />
        )}

        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center">
          <button
            type="button"
            onClick={toggleMode}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold transition-all ${
              inputMode === 'USD'
                ? 'bg-green-500/10 border-green-500/30 text-green-400'
                : 'bg-surface-3 border-border-default text-text-muted hover:border-primary/30 hover:text-primary'
            }`}
            title={`Switch to ${inputMode === 'QIE' ? 'USD' : 'QIE'}`}
            aria-label={`Switch amount input to ${inputMode === 'QIE' ? 'USD' : 'QIE'}`}
          >
            <ArrowRightLeft className="w-3 h-3" />
            {inputMode}
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between px-1">
        <p id={helpId} className="text-xs text-text-muted">
          {value && price ? (
            inputMode === 'QIE' ? (
              <>≈ <span className="text-green-400 font-medium">${usdValue?.toFixed(2)}</span> USD</>
            ) : (
              <>≈ <span className="text-primary font-medium">{value}</span> QIE</>
            )
          ) : price ? (
            <span className="text-text-dim">Enter amount in {inputMode}</span>
          ) : (
            <span className="text-text-dim">{loading ? 'Loading QIE price…' : 'QIE price unavailable'}</span>
          )}
        </p>
        {price && (
          <p className="text-xs text-text-dim">
            1 QIE ≈ ${price.toLocaleString('en-US', { maximumFractionDigits: price < 0.01 ? 6 : price < 1 ? 4 : 2 })}
            {loading && ' ↻'}
          </p>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 rounded-xl border border-border-default bg-surface-2/50 px-3 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <ShoppingCart className="w-3.5 h-3.5 text-text-muted shrink-0" />
          <span className="text-[11px] text-text-muted truncate">Need QIE? Buy on a CEX:</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
          {QIE_EXCHANGES.slice(0, 3).map((ex) => (
            <a
              key={ex.name}
              href={ex.url}
              target="_blank"
              rel="noreferrer"
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-bold transition-colors ${
                ex === primaryExchange
                  ? 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/15'
                  : 'border-border-default text-text-muted hover:border-primary/30 hover:text-primary'
              }`}
              title={`Trade ${ex.pair} on ${ex.name}`}
            >
              {ex.name}
              <ExternalLink className="w-2.5 h-2.5" />
            </a>
          ))}
          <a
            href={QIE_LINKS.wallet}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-border-default text-[10px] font-bold text-text-muted hover:border-secondary/30 hover:text-secondary transition-colors"
            title="Open QIE Wallet"
          >
            Wallet
            <ExternalLink className="w-2.5 h-2.5" />
          </a>
        </div>
      </div>
    </div>
  );
}
