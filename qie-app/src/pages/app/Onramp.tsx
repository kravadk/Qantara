import { useState } from 'react';
import { useAccount } from 'wagmi';
import { OnrampIframe } from '../../components/OnrampIframe';

export function Onramp() {
  const { address } = useAccount();
  const [fiatAmount, setFiatAmount] = useState('50');
  const [fiatCurrency, setFiatCurrency] = useState('USD');
  const [crypto, setCrypto] = useState<'qie' | 'qusdc'>('qie');

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <h1 className="text-xl font-semibold text-slate-100">Buy QIE with card</h1>
      <p className="text-sm text-slate-400">
        Prepare a card purchase intent for your QIE wallet. Provider checkout stays disabled until a backend-hosted session integration is configured.
      </p>

      <div className="grid grid-cols-3 gap-2 rounded-xl border border-slate-700 bg-slate-900/60 p-4">
        <div>
          <label className="text-xs uppercase tracking-wider text-slate-400">Fiat amount</label>
          <input
            type="text"
            inputMode="decimal"
            value={fiatAmount}
            onChange={(e) => setFiatAmount(e.target.value)}
            className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
          />
        </div>
        <div>
          <label className="text-xs uppercase tracking-wider text-slate-400">Currency</label>
          <select
            value={fiatCurrency}
            onChange={(e) => setFiatCurrency(e.target.value)}
            className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
          >
            <option>USD</option>
            <option>EUR</option>
            <option>UAH</option>
            <option>GBP</option>
          </select>
        </div>
        <div>
          <label className="text-xs uppercase tracking-wider text-slate-400">Buy</label>
          <select
            value={crypto}
            onChange={(e) => setCrypto(e.target.value as 'qie' | 'qusdc')}
            className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
          >
            <option value="qie">QIE</option>
            <option value="qusdc">QUSDC</option>
          </select>
        </div>
      </div>

      <OnrampIframe
        walletAddress={address}
        fiatAmount={fiatAmount}
        fiatCurrency={fiatCurrency}
        crypto={crypto}
      />
    </div>
  );
}
