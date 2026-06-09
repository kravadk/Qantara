import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Shield, Repeat, Users2, Users, CalendarClock } from 'lucide-react';
import { Escrow } from './Escrow';
import { Subscription } from './Subscription';
import { BatchPayout } from './BatchPayout';
import { MultiPay } from './MultiPay';
import { InstallmentPlan } from './InstallmentPlan';

type Tab = 'escrow' | 'subscription' | 'installment' | 'batch' | 'multipay';

const TABS: { id: Tab; label: string; icon: typeof Shield; description: string }[] = [
  { id: 'escrow', label: 'Milestone Escrow', icon: Shield, description: '4-tier escrow with optional arbiter' },
  { id: 'subscription', label: 'Subscription', icon: Repeat, description: 'Prefunded recurring payments' },
  { id: 'installment', label: 'Installment Plan', icon: CalendarClock, description: 'Pay over time (BNPL), refundable' },
  { id: 'batch', label: 'Batch Payout', icon: Users2, description: 'CSV-driven payroll, pull claims' },
  { id: 'multipay', label: 'Collective Invoice', icon: Users, description: 'Multiple payers contribute' },
];

/**
 * Advanced hub — wraps V1.5 contract pages under one sidebar entry.
 * Deep-link compatibility: /app/escrow, /app/subscription, /app/batch, /app/multipay
 * still work as routes. This hub is the merchant-facing aggregator.
 */
export function Advanced() {
  const location = useLocation();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('escrow');

  useEffect(() => {
    const q = new URLSearchParams(location.search).get('tab') as Tab | null;
    if (q && TABS.some((t) => t.id === q)) setTab(q);
  }, [location.search]);

  const setTabAndPush = (next: Tab) => {
    setTab(next);
    navigate(`/app/advanced?tab=${next}`, { replace: true });
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="space-y-2">
        <h1 className="text-4xl font-bold text-white tracking-tight">Advanced</h1>
        <p className="text-text-muted">On-chain primitives beyond single-payer invoices.</p>
      </div>

      <div className="flex gap-1 border-b border-border-default overflow-x-auto no-scrollbar">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTabAndPush(t.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-bold border-b-2 transition-colors whitespace-nowrap ${
                active ? 'border-primary text-white' : 'border-transparent text-text-muted hover:text-white'
              }`}
              title={t.description}
            >
              <Icon className="w-4 h-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      <div>
        {tab === 'escrow' && <Escrow />}
        {tab === 'subscription' && <Subscription />}
        {tab === 'installment' && <InstallmentPlan />}
        {tab === 'batch' && <BatchPayout />}
        {tab === 'multipay' && <MultiPay />}
      </div>
    </div>
  );
}
