import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Inbox as InboxIcon, ReceiptText } from 'lucide-react';
import { Inbox } from './Inbox';
import { PaymentProofs } from './PaymentProofs';

type Tab = 'inbox' | 'receipts';

const TABS: { id: Tab; label: string; icon: typeof InboxIcon; description: string }[] = [
  { id: 'inbox', label: 'Inbox', icon: InboxIcon, description: 'Invoices addressed to you + pending refunds' },
  { id: 'receipts', label: 'Receipts', icon: ReceiptText, description: 'Paid invoices history (sent + received)' },
];

export function InboxAndReceipts() {
  const location = useLocation();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('inbox');

  useEffect(() => {
    const q = new URLSearchParams(location.search).get('tab') as Tab | null;
    if (q && TABS.some((t) => t.id === q)) {
      setTab(q);
    } else if (location.pathname === '/app/proofs') {
      setTab('receipts');
    }
  }, [location.search, location.pathname]);

  const setTabAndPush = (next: Tab) => {
    setTab(next);
    navigate(`/app/inbox?tab=${next}`, { replace: true });
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="space-y-2">
        <h1 className="text-4xl font-bold text-white tracking-tight">Activity</h1>
        <p className="text-text-muted">Everything addressed to your wallet — pending pulls, paid invoices, refund queue.</p>
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
        {tab === 'inbox' && <Inbox />}
        {tab === 'receipts' && <PaymentProofs />}
      </div>
    </div>
  );
}
