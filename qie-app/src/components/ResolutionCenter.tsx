import { AlertTriangle, CheckCircle, Clock, RotateCcw, Scale, XCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from './Button';
import { useToastStore } from './ToastContainer';
import type { DealEvent, DealSenderRole } from '../lib/dealRoom';
import {
  approveRefundRequest,
  openDispute,
  rejectRefundRequest,
  requestPayerRefund,
  resolveDispute,
} from '../lib/api/resolutionApi';

type ResolutionAction =
  | 'refund-request'
  | 'dispute-open'
  | 'refund-approve'
  | 'refund-reject'
  | 'dispute-resolved'
  | 'dispute-refunded'
  | 'dispute-rejected';

const RESOLUTION_EVENT_PREFIXES = ['refund.', 'dispute.'];

export function ResolutionCenter({
  invoiceHash,
  role,
  events,
  onResolved,
  compact = false,
}: {
  invoiceHash: string;
  role: DealSenderRole;
  events: DealEvent[];
  onResolved?: () => Promise<void> | void;
  compact?: boolean;
}) {
  const { addToast } = useToastStore();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<ResolutionAction | null>(null);
  const resolutionEvents = useMemo(
    () => events.filter((event) => RESOLUTION_EVENT_PREFIXES.some((prefix) => event.type.startsWith(prefix))).slice().reverse(),
    [events],
  );
  const latest = resolutionEvents[0] ?? null;

  const run = async (action: ResolutionAction, fn: () => Promise<unknown>, success: string) => {
    setBusy(action);
    try {
      await fn();
      setNote('');
      addToast('success', success);
      await onResolved?.();
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : 'Resolution action failed');
    } finally {
      setBusy(null);
    }
  };

  const message = note.trim();

  return (
    <section className="space-y-3 rounded-2xl border border-border-default bg-surface-1 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex gap-2">
          <Scale className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div>
            <h3 className="text-sm font-bold text-white">Resolution center</h3>
            <p className="mt-0.5 text-xs text-text-muted">
              Refund and dispute state is recorded in the timeline. Refunded status changes only after verified on-chain refund.
            </p>
          </div>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold uppercase ${
          latest ? 'bg-yellow-400/10 text-yellow-300' : 'bg-primary/10 text-primary'
        }`}>
          {latest ? latest.type.replace('.', ' ') : 'clean'}
        </span>
      </div>

      <textarea
        value={note}
        onChange={(event) => setNote(event.target.value)}
        maxLength={500}
        rows={compact ? 2 : 3}
        placeholder={role === 'merchant' ? 'Decision message...' : 'Reason for refund or dispute...'}
        className="min-h-11 w-full resize-none rounded-xl border border-border-default bg-surface-2 px-3 py-2 text-sm text-white placeholder:text-text-muted focus:border-primary focus:outline-none"
      />

      {role === 'payer' ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <Button
            variant="secondary"
            size="sm"
            className="gap-2"
            loading={busy === 'refund-request'}
            disabled={busy !== null}
            onClick={() => void run('refund-request', () => requestPayerRefund(invoiceHash, message || 'Refund requested from payer portal.'), 'Refund request recorded')}
          >
            <RotateCcw className="h-4 w-4" /> Request refund
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="gap-2"
            loading={busy === 'dispute-open'}
            disabled={busy !== null}
            onClick={() => void run('dispute-open', () => openDispute(invoiceHash, message || 'Dispute opened from payer portal.'), 'Dispute opened')}
          >
            <AlertTriangle className="h-4 w-4" /> Open dispute
          </Button>
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          <Button
            variant="secondary"
            size="sm"
            className="gap-2"
            loading={busy === 'refund-approve'}
            disabled={busy !== null}
            onClick={() => void run('refund-approve', () => approveRefundRequest(invoiceHash, message || 'Refund approved. Merchant will complete the verified refund transaction.'), 'Refund approval recorded')}
          >
            <CheckCircle className="h-4 w-4" /> Approve refund
          </Button>
          <Button
            variant="danger"
            size="sm"
            className="gap-2"
            loading={busy === 'refund-reject'}
            disabled={busy !== null}
            onClick={() => void run('refund-reject', () => rejectRefundRequest(invoiceHash, message || 'Refund rejected. Continue the dispute in this deal room.'), 'Refund rejection recorded')}
          >
            <XCircle className="h-4 w-4" /> Reject refund
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="gap-2"
            loading={busy === 'dispute-resolved'}
            disabled={busy !== null}
            onClick={() => void run('dispute-resolved', () => resolveDispute(invoiceHash, 'resolved', message || 'Dispute resolved.'), 'Dispute resolved')}
          >
            <Scale className="h-4 w-4" /> Resolve
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="gap-2"
            loading={busy === 'dispute-refunded'}
            disabled={busy !== null}
            onClick={() => void run('dispute-refunded', () => resolveDispute(invoiceHash, 'refunded', message || 'Dispute resolved as refund.'), 'Dispute marked refund-approved')}
          >
            <RotateCcw className="h-4 w-4" /> Mark refund path
          </Button>
        </div>
      )}

      <div className={`${compact ? 'max-h-40' : 'max-h-56'} overflow-y-auto space-y-2`}>
        {resolutionEvents.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border-default bg-surface-2 p-4 text-center text-xs text-text-muted">
            No refund or dispute events yet.
          </div>
        ) : resolutionEvents.map((event) => (
          <div key={event.id} className="rounded-xl border border-border-default bg-surface-2 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs font-bold uppercase tracking-widest text-white">{event.type}</div>
              <div className="inline-flex items-center gap-1 text-[10px] text-text-muted">
                <Clock className="h-3 w-3" /> {new Date(event.createdAt * 1000).toLocaleString()}
              </div>
            </div>
            {Object.keys(event.payload || {}).length > 0 && (
              <pre className="mt-2 max-h-24 overflow-auto rounded-lg bg-surface-1 p-2 text-[10px] text-text-muted">
                {JSON.stringify(event.payload, null, 2)}
              </pre>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
