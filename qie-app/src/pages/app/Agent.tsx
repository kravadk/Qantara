import { useState } from 'react';
import { Loader2, Bot } from 'lucide-react';
import { askCopilot, type CopilotHistoryMessage } from '../../lib/copilot';

export function Agent() {
  const [history, setHistory] = useState<CopilotHistoryMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  async function ask() {
    const q = draft.trim();
    if (!q || busy) return;
    setBusy(true);
    setDraft('');
    setHistory((h) => [...h, { role: 'user', content: q }]);
    const res = await askCopilot({ question: q, history });
    if (res.ok && res.answer) {
      setHistory((h) => [...h, { role: 'assistant', content: res.answer! }]);
    } else {
      setHistory((h) => [...h, { role: 'assistant', content: `⚠️ ${res.error ?? 'failed'}` }]);
    }
    setBusy(false);
  }

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col gap-4 p-4">
      <div className="flex items-center gap-2 text-xl font-semibold text-slate-100">
        <Bot className="h-5 w-5 text-indigo-400" /> AI Copilot
      </div>
      <div className="flex-1 overflow-y-auto rounded-xl border border-slate-700 bg-slate-900/60 p-4 space-y-2">
        {history.length === 0 ? (
          <div className="text-center text-sm text-slate-500 py-12">
            Ask about invoices, payments, splits, streams, gas, permit, anything.
          </div>
        ) : (
          history.map((m, i) => (
            <div
              key={i}
              className={`max-w-[80%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
                m.role === 'user' ? 'ml-auto bg-indigo-600/30' : 'bg-slate-700/40'
              } text-slate-100`}
            >
              {m.content}
            </div>
          ))
        )}
        {busy ? (
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Loader2 className="h-3 w-3 animate-spin" /> thinking…
          </div>
        ) : null}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask anything…"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void ask();
            }
          }}
          disabled={busy}
          className="flex-1 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-500/50 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => void ask()}
          disabled={!draft.trim() || busy}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          Send
        </button>
      </div>
      <div className="text-[10px] text-slate-500 text-center">
        AI may be wrong — always verify on chain.
      </div>
    </div>
  );
}
