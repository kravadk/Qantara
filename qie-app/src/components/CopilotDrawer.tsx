import { useState } from 'react';
import { Bot, Loader2, MessageCircle, X } from 'lucide-react';
import { askCopilot, type CopilotHistoryMessage } from '../lib/copilot';

interface CopilotDrawerProps {
  invoiceHash?: string;
  presets?: string[];
}

const DEFAULT_PRESETS = [
  'What is this invoice?',
  'How do I pay?',
  'Is this safe?',
  'What is permit?',
];

/**
 * Slide-out AI copilot. Floating "?" button anchored to right edge; opens a
 * chat panel with conversation history and quick prompts.
 */
export function CopilotDrawer({ invoiceHash, presets = DEFAULT_PRESETS }: CopilotDrawerProps) {
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<CopilotHistoryMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    setBusy(true);
    setDraft('');
    setHistory((h) => [...h, { role: 'user', content: q }]);
    const res = await askCopilot({ question: q, invoiceHash, history });
    if (res.ok && res.answer) {
      setHistory((h) => [...h, { role: 'assistant', content: res.answer! }]);
    } else {
      setHistory((h) => [
        ...h,
        { role: 'assistant', content: `Warning: ${res.error ?? 'request failed'}` },
      ]);
    }
    setBusy(false);
  }

  return (
    <>
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-indigo-600 text-white shadow-lg hover:bg-indigo-500"
          aria-label="Open AI copilot"
        >
          <Bot className="h-5 w-5" />
        </button>
      ) : null}
      {open ? (
        <div className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-slate-700 bg-slate-900 shadow-2xl">
          <div className="flex items-center justify-between border-b border-slate-700 px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
              <MessageCircle className="h-4 w-4 text-indigo-400" /> AI checkout copilot
            </div>
            <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-100">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
            {history.length === 0 ? (
              <div className="space-y-2">
                <div className="text-xs text-slate-500">Quick questions:</div>
                {presets.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => void ask(p)}
                    className="block w-full rounded-md border border-slate-700 bg-slate-800/40 px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-800"
                  >
                    {p}
                  </button>
                ))}
              </div>
            ) : (
              history.map((m, i) => (
                <div
                  key={i}
                  className={`max-w-[90%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
                    m.role === 'user'
                      ? 'ml-auto bg-indigo-600/30 text-indigo-50'
                      : 'bg-slate-700/40 text-slate-100'
                  }`}
                >
                  {m.content}
                </div>
              ))
            )}
            {busy ? (
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <Loader2 className="h-3 w-3 animate-spin" /> Thinking...
              </div>
            ) : null}
          </div>

          <div className="border-t border-slate-700 p-3">
            <div className="mb-2 text-[10px] text-slate-500">
              AI may be wrong. Always verify on chain.
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Ask anything..."
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void ask(draft);
                  }
                }}
                disabled={busy}
                className="flex-1 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-500/50 disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => void ask(draft)}
                disabled={!draft.trim() || busy}
                className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
