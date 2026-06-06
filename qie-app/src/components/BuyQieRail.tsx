import { useState } from 'react';
import { ShoppingCart, ExternalLink, ChevronDown, Coins } from 'lucide-react';
import { useQiePrice } from '../hooks/useQiePrice';
import { QIE_EXCHANGES, QIE_LINKS } from '../lib/qieResources';

/**
 * Compact sidebar widget showing live QIE price + collapsible list of where to buy.
 * Provides project-wide discoverability of QIE token sources.
 */
export function BuyQieRail() {
  const { price, loading } = useQiePrice();
  const [open, setOpen] = useState(false);

  const primary = QIE_EXCHANGES[0];

  return (
    <div className="rounded-xl border border-border-default bg-surface-2/60 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 hover:bg-surface-2 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          <Coins className="w-3.5 h-3.5 text-primary shrink-0" />
          <span className="text-[11px] font-bold text-text-secondary">QIE</span>
          <span className="text-[11px] text-text-muted truncate">
            {price ? (
              <>${price.toLocaleString('en-US', { maximumFractionDigits: price < 0.01 ? 6 : price < 1 ? 4 : 2 })}</>
            ) : loading ? (
              'loading…'
            ) : (
              'unavailable'
            )}
          </span>
        </div>
        <ChevronDown className={`w-3.5 h-3.5 text-text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="border-t border-border-default p-2 space-y-2">
          <div className="text-[10px] font-bold uppercase tracking-widest text-text-muted px-1">Buy on CEX</div>
          <div className="space-y-1">
            {QIE_EXCHANGES.map((ex) => (
              <a
                key={ex.name}
                href={ex.url}
                target="_blank"
                rel="noreferrer"
                className={`flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg border text-[11px] transition-colors ${
                  ex === primary
                    ? 'border-primary/30 bg-primary/5 text-primary hover:bg-primary/10'
                    : 'border-border-default text-text-secondary hover:border-primary/30 hover:text-primary'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="font-bold">{ex.name}</span>
                  <span className="text-text-muted">{ex.pair}</span>
                  {ex.badge && (
                    <span className="text-[9px] font-bold uppercase tracking-widest text-primary/70 border border-primary/30 rounded px-1 py-px">
                      {ex.badge}
                    </span>
                  )}
                </div>
                <ExternalLink className="w-3 h-3 shrink-0" />
              </a>
            ))}
          </div>

          <div className="text-[10px] font-bold uppercase tracking-widest text-text-muted px-1 pt-1">Ecosystem</div>
          <div className="grid grid-cols-2 gap-1">
            <a href={QIE_LINKS.wallet} target="_blank" rel="noreferrer" className="flex items-center justify-between px-2 py-1 rounded-lg border border-border-default text-[10px] text-text-secondary hover:border-secondary/30 hover:text-secondary transition-colors">
              Wallet <ExternalLink className="w-2.5 h-2.5" />
            </a>
            <a href={QIE_LINKS.mainnet} target="_blank" rel="noreferrer" className="flex items-center justify-between px-2 py-1 rounded-lg border border-border-default text-[10px] text-text-secondary hover:border-secondary/30 hover:text-secondary transition-colors">
              Mainnet <ExternalLink className="w-2.5 h-2.5" />
            </a>
            <a href={QIE_LINKS.homepage} target="_blank" rel="noreferrer" className="flex items-center justify-between px-2 py-1 rounded-lg border border-border-default text-[10px] text-text-secondary hover:border-secondary/30 hover:text-secondary transition-colors">
              qie.digital <ExternalLink className="w-2.5 h-2.5" />
            </a>
            <a href={QIE_LINKS.coingecko} target="_blank" rel="noreferrer" className="flex items-center justify-between px-2 py-1 rounded-lg border border-border-default text-[10px] text-text-secondary hover:border-secondary/30 hover:text-secondary transition-colors">
              CoinGecko <ExternalLink className="w-2.5 h-2.5" />
            </a>
          </div>

          {price && (
            <a
              href={primary.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-center gap-1 mt-1 px-3 py-1.5 rounded-lg bg-primary text-bg-base text-[11px] font-bold hover:bg-primary/90 transition-colors"
            >
              <ShoppingCart className="w-3 h-3" /> Buy QIE on {primary.name}
            </a>
          )}
        </div>
      )}
    </div>
  );
}
