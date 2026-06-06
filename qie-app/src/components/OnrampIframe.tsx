import { CreditCard, ExternalLink, ShieldCheck } from 'lucide-react';

interface OnrampIframeProps {
  walletAddress?: string;
  fiatAmount?: string;
  fiatCurrency?: string;
  crypto?: 'qie' | 'qusdc';
  invoiceHash?: string;
}

const QIE_DOCS_URL = 'https://docs.qie.digital/';
const QIE_EXPLORER_URL = 'https://explorer.qie.digital/';

export function OnrampIframe(props: OnrampIframeProps) {
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
          <CreditCard className="h-4 w-4 text-emerald-400" /> Card onramp
        </div>
        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-emerald-300">
          <ShieldCheck className="h-3 w-3" /> server-session only
        </span>
      </div>

      <div className="rounded-lg border border-dashed border-slate-700 bg-slate-900/40 p-8 text-sm text-slate-300">
        <h2 className="text-base font-semibold text-slate-100">Provider checkout is not enabled in this browser build</h2>
        <p className="mt-2 max-w-2xl text-slate-400">
          Qantara does not place onramp provider credentials or provider checkout parameters in the SPA. Card checkout should be enabled through a backend-created provider session after partner approval.
        </p>

        <div className="mt-5 grid gap-2 text-xs text-slate-400 sm:grid-cols-2">
          <InfoLine label="Wallet" value={props.walletAddress ?? 'connect wallet'} />
          <InfoLine label="Intent" value={`${props.fiatAmount || '0'} ${props.fiatCurrency || 'USD'} to ${props.crypto === 'qusdc' ? 'QUSDC' : 'QIE'}`} />
          <InfoLine label="Invoice" value={props.invoiceHash ?? 'not scoped'} />
          <InfoLine label="Trust model" value="no browser credential exposure" />
        </div>

        <div className="mt-5 flex flex-wrap gap-3">
          <a href={QIE_DOCS_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-emerald-300 hover:text-emerald-200">
            QIE docs <ExternalLink className="h-3 w-3" />
          </a>
          <a href={QIE_EXPLORER_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-emerald-300 hover:text-emerald-200">
            QIE explorer <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>
    </div>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border border-slate-800 bg-slate-950/40 px-3 py-2">
      <div className="text-[10px] uppercase tracking-widest text-slate-500">{label}</div>
      <div className="mt-0.5 truncate font-mono text-slate-300">{value}</div>
    </div>
  );
}
