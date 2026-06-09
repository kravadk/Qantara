import { Clock, MessageSquare, RefreshCw, Send, ShieldCheck, ShieldQuestion } from 'lucide-react';
import { useState } from 'react';
import { Button } from './Button';
import { useDealRoom } from '../hooks/useDealRoom';
import type { DealSenderRole } from '../lib/dealRoom';
import { ResolutionCenter } from './ResolutionCenter';
import { useSiweAuth } from '../lib/auth';

const timeFormatter = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

export function DealRoomPanel({
  invoiceHash,
  role,
  title = 'Deal room',
  compact = false,
}: {
  invoiceHash: string;
  role: DealSenderRole;
  title?: string;
  compact?: boolean;
}) {
  const { messages, events, isLoading, isSending, error, streamStatus, sendMessage, refresh } = useDealRoom(invoiceHash, role);
  const [draft, setDraft] = useState('');
  const { isAuthenticated, login, status: authStatus } = useSiweAuth();
  // Merchant chat/resolution is authenticated by a SIWE session (a connected wallet is not
  // enough). Payers post with a per-invoice guest token, so only the merchant side needs this.
  const needsSignIn = role === 'merchant' && !isAuthenticated;

  const submit = async () => {
    const body = draft.trim();
    if (!body) return;
    setDraft('');
    await sendMessage(body, role === 'merchant' ? 'Merchant' : 'Payer');
  };

  return (
    <div className="bg-surface-1 border border-border-default rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-border-default px-4 py-3">
        <div className="flex items-center gap-2 min-w-0">
          <MessageSquare className="h-4 w-4 text-primary shrink-0" />
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-white truncate">{title}</h3>
            <p className="text-[10px] uppercase tracking-widest text-text-muted">
              {streamStatus === 'connected'
                ? 'Live invoice chat'
                : streamStatus === 'connecting'
                  ? 'Connecting live updates'
                  : streamStatus === 'error'
                    ? 'Refresh available'
                    : 'Invoice chat and timeline'}
            </p>
          </div>
        </div>
        <button
          onClick={() => void refresh()}
          className="p-2 rounded-lg text-text-muted hover:text-primary hover:bg-surface-2"
          aria-label="Refresh deal room"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className={`${compact ? 'max-h-64' : 'max-h-80'} overflow-y-auto p-4 space-y-3`}>
        {messages.length === 0 ? (
          <div className="py-8 text-center">
            <ShieldQuestion className="mx-auto mb-3 h-8 w-8 text-text-dim" />
            <p className="text-sm font-bold text-text-secondary">No messages yet</p>
            <p className="mt-1 text-xs text-text-muted">Ask a question before paying or keep delivery notes here.</p>
          </div>
        ) : messages.map((message) => {
          const mine = message.senderRole === role;
          const system = message.senderRole === 'system';
          return (
            <div key={message.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[86%] rounded-2xl px-3 py-2 ${
                system
                  ? 'border border-yellow-500/20 bg-yellow-500/10 text-yellow-100'
                  : mine
                    ? 'bg-primary text-black'
                    : 'bg-surface-2 border border-border-default text-white'
              }`}>
                <div className={`mb-1 flex items-center gap-1 text-[10px] uppercase tracking-widest ${
                  mine && !system ? 'text-black/60' : 'text-text-muted'
                }`}>
                  {message.senderLabel || message.senderRole}
                  <Clock className="h-2.5 w-2.5" />
                  {timeFormatter.format(new Date(message.createdAt * 1000))}
                </div>
                <p className="whitespace-pre-wrap break-words text-sm">{message.body}</p>
              </div>
            </div>
          );
        })}
      </div>

      {error && <div className="px-4 pb-2 text-xs text-red-300">{error}</div>}

      <div className="border-t border-border-default p-3 space-y-3">
        {needsSignIn ? (
          <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-3 text-center space-y-2">
            <p className="text-xs text-text-muted">Sign in with your merchant wallet to reply and resolve this invoice. Connecting a wallet alone isn't enough.</p>
            <Button
              size="sm"
              className="gap-2"
              loading={authStatus === 'signing' || authStatus === 'verifying'}
              onClick={() => void login()}
            >
              <ShieldCheck className="h-4 w-4" /> Sign in with wallet
            </Button>
          </div>
        ) : (
          <>
            <div className="flex gap-2">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void submit();
                  }
                }}
                maxLength={1000}
                rows={compact ? 2 : 3}
                aria-label={role === 'merchant' ? 'Reply to payer' : 'Ask merchant about this invoice'}
                placeholder={role === 'merchant' ? 'Reply to payer...' : 'Ask merchant about this invoice...'}
                className="min-h-11 flex-1 resize-none rounded-xl border border-border-default bg-surface-2 px-3 py-2 text-sm text-white placeholder:text-text-muted focus:border-primary focus:outline-none"
              />
              <Button
                size="sm"
                className="self-end px-3"
                loading={isSending}
                disabled={!draft.trim()}
                onClick={() => void submit()}
                aria-label="Send deal room message"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>

            <ResolutionCenter invoiceHash={invoiceHash} role={role} events={events} onResolved={refresh} compact={compact} />
          </>
        )}
      </div>
    </div>
  );
}
