import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Code, BookOpen, Search } from 'lucide-react';
import { Build } from './Build';
import { Guide } from './Guide';
import { Explorer } from './Explorer';

type Tab = 'build' | 'guide' | 'explorer';

const TABS: { id: Tab; label: string; icon: typeof Code }[] = [
  { id: 'build', label: 'SDK & Embeds', icon: Code },
  { id: 'guide', label: 'Integration Guide', icon: BookOpen },
  { id: 'explorer', label: 'Public Explorer', icon: Search },
];

export function Developer() {
  const location = useLocation();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('build');

  useEffect(() => {
    const q = new URLSearchParams(location.search).get('tab') as Tab | null;
    if (q && TABS.some((t) => t.id === q)) setTab(q);
  }, [location.search]);

  const setTabAndPush = (next: Tab) => {
    setTab(next);
    navigate(`/app/developer?tab=${next}`, { replace: true });
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="space-y-2">
        <h1 className="text-4xl font-bold text-white tracking-tight">Developer</h1>
        <p className="text-text-muted">SDKs, integration patterns, and a public on-chain explorer.</p>
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
            >
              <Icon className="w-4 h-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      <div>
        {tab === 'build' && <Build />}
        {tab === 'guide' && <Guide />}
        {tab === 'explorer' && <Explorer />}
      </div>
    </div>
  );
}
