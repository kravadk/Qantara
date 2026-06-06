import { useEffect, useState } from 'react';
import { Globe } from 'lucide-react';
import { getLang, setLang, SUPPORTED_LANGS, type Lang } from '../lib/i18n';

const LABEL: Record<Lang, string> = { en: 'EN', uk: 'УКР' };

export function LangSwitcher() {
  const [current, setCurrent] = useState<Lang>(getLang());

  useEffect(() => {
    const id = setInterval(() => setCurrent(getLang()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-900/40 p-1">
      <Globe className="ml-1 h-3.5 w-3.5 text-slate-500" />
      {SUPPORTED_LANGS.map((lang) => (
        <button
          key={lang}
          type="button"
          onClick={() => {
            setLang(lang);
            setCurrent(lang);
          }}
          aria-pressed={current === lang}
          className={`rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase transition ${
            current === lang ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          {LABEL[lang]}
        </button>
      ))}
    </div>
  );
}
