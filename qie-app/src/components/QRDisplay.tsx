import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Globe, Wallet, Link2 } from 'lucide-react';

type QRMode = 'web' | 'wallet' | 'qantara';

interface QRDisplayProps {
  /** Web URL — opens the pay page in any browser. */
  value: string;
  /** Optional EIP-681 deep-link (`ethereum:...`) for direct wallet hand-off. */
  eip681?: string;
  /** Optional canonical Qantara link (`qantara://pay?...`) — interoperable standard. */
  qantara?: string;
  size?: number;
}

/**
 * QR with optional toggle between a web URL, an EIP-681 wallet deep-link, and the
 * canonical `qantara://pay` link. If both `eip681` and `qantara` are omitted,
 * behaves like the original single-QR component.
 */
export function QRDisplay({ value, eip681, qantara, size = 200 }: QRDisplayProps) {
  const [mode, setMode] = useState<QRMode>('web');

  if (!eip681 && !qantara) {
    return (
      <div className="bg-white p-4 rounded-xl inline-block">
        <QRCodeSVG
          value={value}
          size={size}
          bgColor="#FFFFFF"
          fgColor="#0a0a0a"
          level="H"
          includeMargin={false}
        />
      </div>
    );
  }

  const effectiveMode: QRMode = (mode === 'wallet' && !eip681) || (mode === 'qantara' && !qantara) ? 'web' : mode;
  const shown = effectiveMode === 'web' ? value : effectiveMode === 'wallet' ? eip681! : qantara!;

  return (
    <div className="inline-flex flex-col items-center gap-2">
      <div className="bg-white p-4 rounded-xl">
        <QRCodeSVG
          value={shown}
          size={size}
          bgColor="#FFFFFF"
          fgColor="#0a0a0a"
          level="H"
          includeMargin={false}
        />
      </div>
      <div className="flex gap-1 rounded-md border border-slate-700 bg-slate-900/60 p-1 text-xs">
        <button
          type="button"
          onClick={() => setMode('web')}
          className={`flex items-center gap-1 rounded px-2 py-1 transition ${
            effectiveMode === 'web' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200'
          }`}
          aria-pressed={effectiveMode === 'web'}
        >
          <Globe className="h-3 w-3" /> Web URL
        </button>
        {eip681 && (
          <button
            type="button"
            onClick={() => setMode('wallet')}
            className={`flex items-center gap-1 rounded px-2 py-1 transition ${
              effectiveMode === 'wallet' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
            aria-pressed={effectiveMode === 'wallet'}
          >
            <Wallet className="h-3 w-3" /> Wallet (EIP-681)
          </button>
        )}
        {qantara && (
          <button
            type="button"
            onClick={() => setMode('qantara')}
            className={`flex items-center gap-1 rounded px-2 py-1 transition ${
              effectiveMode === 'qantara' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
            aria-pressed={effectiveMode === 'qantara'}
          >
            <Link2 className="h-3 w-3" /> Qantara
          </button>
        )}
      </div>
    </div>
  );
}
