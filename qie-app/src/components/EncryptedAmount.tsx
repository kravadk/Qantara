import { Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';

interface EncryptedAmountProps {
  invoiceHash?: string;
  amount?: string;
  currency?: string;
  compact?: boolean;
}

export function EncryptedAmount({ amount, currency = 'QIE', compact = false }: EncryptedAmountProps) {
  const [revealed, setRevealed] = useState(true);
  const textSize = compact ? 'text-sm' : 'text-lg';
  const displayAmount = amount && Number.isFinite(Number(amount)) ? amount : '0';

  return (
    <div className="inline-flex items-center gap-2">
      <div className="flex items-center gap-1">
        <span className={`${textSize} font-bold text-white`}>
          {revealed ? displayAmount : '••••••'}
        </span>
        <span className="text-sm text-text-muted">{currency}</span>
      </div>
      <button
        type="button"
        onClick={() => setRevealed((value) => !value)}
        className="rounded-lg p-1.5 text-text-muted transition-all hover:bg-primary/10 hover:text-primary"
        title={revealed ? 'Hide amount' : 'Show backend invoice amount'}
      >
        {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}
