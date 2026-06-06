import { Copy, CheckCircle } from 'lucide-react';
import { useState } from 'react';

export function CodeBlock({ code, language }: { code: string; language: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group">
      <div className="absolute top-4 right-4 z-10">
        <button
          onClick={handleCopy}
          className="p-2 rounded-lg bg-surface-3 border border-border-default text-text-secondary hover:text-white transition-colors"
        >
          {copied ? <CheckCircle className="w-4 h-4 text-primary" /> : <Copy className="w-4 h-4" />}
        </button>
      </div>
      <pre className="bg-surface-2 border border-border-default rounded-2xl p-6 overflow-x-auto font-mono text-sm text-text-secondary">
        <code className={`language-${language}`}>{code}</code>
      </pre>
    </div>
  );
}
