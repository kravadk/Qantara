import { AnimatePresence, motion } from 'framer-motion';
import { Activity, CheckCircle, Copy, ExternalLink, Link2, Lock, MessageSquare, ReceiptText, Route, Scale, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Invoice } from '../store/useInvoiceStore';
import { useDealRoom } from '../hooks/useDealRoom';
import { StatusBadge, TypeBadge } from './Badge';
import { DealRoomPanel } from './DealRoomPanel';
import { EncryptedAmount } from './EncryptedAmount';
import { ResolutionCenter } from './ResolutionCenter';
import { useToastStore } from './ToastContainer';
import {
  getReceipt,
  listChainEvents,
  listWebhookDeliveries,
  retryWebhookDelivery,
  type ChainEventRecord,
  type ReceiptRecord,
  type WebhookDeliveryRecord,
} from '../lib/qantaraApi';
import { qieMainnet } from '../config/wagmi';

export function SideDrawer({ isOpen, onClose, invoice }: { isOpen: boolean; onClose: () => void; invoice: Invoice | null }) {
  const { addToast } = useToastStore();
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'details' | 'chat' | 'resolution' | 'timeline' | 'chain' | 'receipt' | 'webhook'>('details');
  const [receipt, setReceipt] = useState<ReceiptRecord | null>(null);
  const [webhookDeliveries, setWebhookDeliveries] = useState<WebhookDeliveryRecord[]>([]);
  const [chainEvents, setChainEvents] = useState<ChainEventRecord[]>([]);
  const [retryingDeliveryId, setRetryingDeliveryId] = useState<string | null>(null);
  const { events, unreadCount } = useDealRoom(invoice?.hash, 'merchant');

  // Explorer link should open the on-chain transaction (paid receipt or indexed chain event),
  // not a block. Falls back to the merchant address page when no tx hash is known yet.
  const explorerBase = qieMainnet.blockExplorers.default.url;
  const explorerTxHash = receipt?.txHash ?? chainEvents.find((event) => event.txHash)?.txHash ?? null;
  const explorerHref = explorerTxHash
    ? `${explorerBase}/tx/${explorerTxHash}`
    : invoice?.seller
      ? `${explorerBase}/address/${invoice.seller}`
      : explorerBase;

  useEffect(() => {
    if (!invoice?.hash) {
      setReceipt(null);
      setWebhookDeliveries([]);
      setChainEvents([]);
      return;
    }
    void getReceipt(invoice.hash).then(setReceipt).catch(() => setReceipt(null));
    void listWebhookDeliveries({ invoiceHash: invoice.hash, limit: 20 })
      .then((result) => setWebhookDeliveries(result.deliveries))
      .catch(() => setWebhookDeliveries([]));
    void listChainEvents({ invoiceHash: invoice.hash, limit: 20 })
      .then((result) => setChainEvents(result.events))
      .catch(() => setChainEvents([]));
  }, [invoice?.hash]);

  const handleCopy = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    addToast('success', `${field} copied`);
    setTimeout(() => setCopiedField(null), 1500);
  };

  const handleRetryWebhook = async (deliveryId: string) => {
    setRetryingDeliveryId(deliveryId);
    try {
      const result = await retryWebhookDelivery(deliveryId);
      setWebhookDeliveries((items) => items.map((item) => item.id === deliveryId ? result.delivery : item));
      addToast('success', 'Webhook retry submitted');
    } catch (err: any) {
      addToast('error', err?.message?.slice(0, 100) || 'Webhook retry failed');
    } finally {
      setRetryingDeliveryId(null);
    }
  };

  if (!invoice) return null;

  const isAnyone = !invoice.recipient || invoice.recipient === '0x0000000000000000000000000000000000000000';
  const hasMemo = invoice.memo && invoice.memo.trim().length > 0;
  const hasDeadline = invoice.deadline && new Date(invoice.deadline).getTime() > 0;
  const tabs = [
    ['details', Lock, 'Details'],
    ['chat', MessageSquare, 'Chat'],
    ['resolution', Scale, 'Resolve'],
    ['timeline', Activity, 'Timeline'],
    ['chain', Route, 'Chain'],
    ['receipt', ReceiptText, 'Receipt'],
    ['webhook', Activity, 'Webhook'],
  ] as const;

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[10000] flex justify-end">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
          />
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="relative h-full w-full max-w-[460px] overflow-y-auto border-l border-border-default bg-surface-1"
          >
            <div className="p-6 sm:p-8">
              <div className="mb-8 flex items-center justify-between">
                <h2 className="text-xl font-bold text-white">Invoice Details</h2>
                <button onClick={onClose} className="rounded-full p-2 text-text-secondary transition-colors hover:bg-surface-2">
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="space-y-6">
                <div className="flex flex-wrap items-center gap-3">
                  <StatusBadge status={invoice.status} />
                  <TypeBadge type={invoice.type} />
                  {unreadCount > 0 && (
                    <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-black">
                      {unreadCount} unread
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-1 rounded-xl border border-border-default bg-surface-2 p-1 sm:grid-cols-6">
                  {tabs.map(([id, Icon, label]) => (
                    <button
                      key={id}
                      onClick={() => setActiveTab(id)}
                      className={`flex items-center justify-center gap-1 rounded-lg px-2 py-2 text-[10px] font-bold uppercase tracking-widest transition-colors ${
                        activeTab === id ? 'bg-primary text-black' : 'text-text-muted hover:text-white'
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">{label}</span>
                    </button>
                  ))}
                </div>

                {activeTab === 'details' && (
                  <>
                    <div className="space-y-2 rounded-2xl border border-border-default bg-surface-2 p-4">
                      <p className="text-xs uppercase tracking-widest text-text-muted">Invoice Hash</p>
                      <div className="flex items-center justify-between gap-2">
                        <p className="break-all font-mono text-xs text-white">{invoice.hash.slice(0, 18)}...{invoice.hash.slice(-10)}</p>
                        <button
                          onClick={() => handleCopy(invoice.hash, 'Hash')}
                          className="shrink-0 rounded-lg p-1.5 text-text-muted transition-colors hover:bg-surface-3 hover:text-primary"
                        >
                          {copiedField === 'Hash' ? <CheckCircle className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-primary/10 bg-surface-2 p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Lock className="h-3.5 w-3.5 text-primary" />
                          <p className="text-sm text-text-secondary">Amount</p>
                        </div>
                        <EncryptedAmount invoiceHash={invoice.hash} amount={invoice.amount} />
                      </div>
                    </div>

                    <div className="space-y-3 rounded-2xl border border-border-default bg-surface-2 p-4">
                      <InfoRow label="Recipient" value={isAnyone ? 'Anyone' : `${invoice.recipient!.slice(0, 6)}...${invoice.recipient!.slice(-4)}`} mono />
                      <InfoRow label="Created" value={new Date(invoice.createdAt).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })} />
                      {hasDeadline && (
                        <InfoRow label="Deadline" value={new Date(invoice.deadline!).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })} />
                      )}
                      {hasMemo && <InfoRow label="Memo" value={invoice.memo} align="right" />}
                    </div>

                    <div className="flex items-center justify-between px-1 text-xs text-text-dim">
                      <span>{explorerTxHash ? 'On-chain transaction' : 'On-chain proof'}</span>
                      <a href={explorerHref} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1 transition-colors hover:text-primary">
                        {explorerTxHash ? 'Transaction' : 'Explorer'} <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    </div>
                  </>
                )}

                {activeTab === 'chat' && <DealRoomPanel invoiceHash={invoice.hash} role="merchant" counterparty={invoice.recipient} compact />}

                {activeTab === 'resolution' && (
                  <ResolutionCenter invoiceHash={invoice.hash} role="merchant" events={events} compact />
                )}

                {activeTab === 'timeline' && (
                  <div className="space-y-3">
                    {events.length === 0 ? (
                      <div className="rounded-2xl border border-border-default bg-surface-2 p-8 text-center text-sm text-text-muted">
                        Timeline events will appear after chat or payment activity.
                      </div>
                    ) : events.slice().reverse().map((event) => (
                      <div key={event.id} className="rounded-2xl border border-border-default bg-surface-2 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-xs font-bold uppercase tracking-widest text-white">{event.type}</p>
                          <p className="text-[10px] text-text-muted">{new Date(event.createdAt * 1000).toLocaleString()}</p>
                        </div>
                        {'preview' in event.payload && (
                          <p className="mt-2 text-sm text-text-secondary">{String(event.payload.preview)}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {activeTab === 'receipt' && (
                  <div className="space-y-3 rounded-2xl border border-border-default bg-surface-2 p-4">
                    <InfoRow label="Receipt status" value={receipt ? 'Ready' : 'Pending verified payment'} />
                    <InfoRow label="Amount" value={`${invoice.amount || '-'} ${invoice.token ?? 'QIE'}`} />
                    {receipt && (
                      <>
                        <InfoRow label="Receipt hash" value={`${receipt.receiptHash.slice(0, 12)}...${receipt.receiptHash.slice(-8)}`} mono />
                        <InfoRow label="Tx" value={`${receipt.txHash.slice(0, 12)}...${receipt.txHash.slice(-8)}`} mono />
                        <InfoRow label="Issued" value={new Date(receipt.issuedAt * 1000).toLocaleString()} />
                        <InfoRow label="Anchor" value={receipt.verification?.onChainAnchor.status ?? 'backend receipt only'} />
                        <InfoRow label="Registry" value={receipt.verification?.onChainAnchor.registryAddress ?? 'not configured'} mono />
                      </>
                    )}
                    <p className="text-xs text-text-muted">Receipts are issued only after RPC/indexer verified payment state.</p>
                  </div>
                )}

                {activeTab === 'chain' && (
                  <div className="space-y-3">
                    {chainEvents.length === 0 ? (
                      <div className="rounded-2xl border border-border-default bg-surface-2 p-8 text-center text-sm text-text-muted">
                        On-chain proof appears after indexer sync or verified lifecycle actions.
                      </div>
                    ) : chainEvents.map((event) => (
                      <div key={event.id} className="rounded-2xl border border-border-default bg-surface-2 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-xs font-bold uppercase tracking-widest text-white">{event.eventType}</p>
                          <a
                            href={`${qieMainnet.blockExplorers.default.url}/tx/${event.txHash}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 font-mono text-[10px] text-text-muted hover:text-primary"
                          >
                            {event.txHash.slice(0, 10)}...{event.txHash.slice(-6)} <ExternalLink className="h-3 w-3" />
                          </a>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                          <InfoRow label="Block" value={String(event.blockNumber)} />
                          <InfoRow label="Log" value={String(event.logIndex)} />
                          <InfoRow label="Contract" value={`${event.contractAddress.slice(0, 6)}...${event.contractAddress.slice(-4)}`} mono />
                          <InfoRow label="Indexed" value={new Date(event.createdAt * 1000).toLocaleString()} />
                        </div>
                        {Object.keys(event.payload || {}).length > 0 && (
                          <pre className="mt-3 max-h-28 overflow-auto rounded-xl border border-border-default bg-bg-base p-3 text-[10px] text-text-muted">
                            {JSON.stringify(event.payload, null, 2)}
                          </pre>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {activeTab === 'webhook' && (
                  <div className="space-y-3">
                    {webhookDeliveries.length === 0 ? (
                      <div className="rounded-2xl border border-border-default bg-surface-2 p-8 text-center text-sm text-text-muted">
                        Delivery attempts appear after this invoice triggers a configured webhook.
                      </div>
                    ) : webhookDeliveries.map((delivery) => (
                      <div key={delivery.id} className="rounded-2xl border border-border-default bg-surface-2 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-xs font-bold uppercase tracking-widest text-white">{delivery.eventType}</p>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${delivery.status >= 200 && delivery.status < 300 ? 'bg-primary/10 text-primary' : 'bg-red-500/10 text-red-300'}`}>
                            {delivery.status || 'network'}
                          </span>
                        </div>
                        <p className="mt-2 truncate text-xs text-text-muted">{delivery.targetUrl}</p>
                        <p className="mt-1 text-xs text-text-secondary">Attempts: {delivery.attempts}{delivery.lastError ? ` · ${delivery.lastError}` : ''}</p>
                        {(delivery.status < 200 || delivery.status >= 300) && (
                          <button
                            type="button"
                            onClick={() => void handleRetryWebhook(delivery.id)}
                            disabled={retryingDeliveryId === delivery.id}
                            className="mt-3 rounded-lg border border-border-default px-3 py-1.5 text-xs font-bold text-text-secondary transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-50"
                          >
                            {retryingDeliveryId === delivery.id ? 'Retrying...' : 'Retry now'}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <div className="space-y-2 pt-2">
                  <button onClick={() => handleCopy(`${window.location.origin}/pay/${invoice.hash}`, 'Payment Link')}
                    className="group flex w-full items-center gap-3 rounded-xl border border-border-default bg-surface-2 p-3.5 text-left transition-colors hover:border-primary/30">
                    <Link2 className="h-4 w-4 text-text-muted group-hover:text-primary" />
                    <span className="text-sm text-text-secondary group-hover:text-white">Copy Payment Link</span>
                  </button>
                  <a href={explorerHref} target="_blank" rel="noopener noreferrer"
                    className="group flex w-full items-center gap-3 rounded-xl border border-border-default bg-surface-2 p-3.5 transition-colors hover:border-primary/30">
                    <ExternalLink className="h-4 w-4 text-text-muted group-hover:text-primary" />
                    <span className="text-sm text-text-secondary group-hover:text-white">{explorerTxHash ? 'View transaction on Explorer' : 'View on Explorer'}</span>
                  </a>
                  {invoice.status === 'open' && (
                    <a href={`/pay/${invoice.hash}`}
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary p-3.5 font-bold text-black transition-colors hover:bg-primary/90">
                      Pay This Invoice
                    </a>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

function InfoRow({ label, value, mono, align }: { label: string; value?: string; mono?: boolean; align?: 'right' }) {
  return (
    <div className={`flex justify-between gap-4 ${align === 'right' ? 'items-start' : 'items-center'}`}>
      <p className="text-xs text-text-muted">{label}</p>
      <p className={`max-w-[230px] text-xs text-white ${mono ? 'font-mono' : ''} ${align === 'right' ? 'text-right' : ''}`}>{value || '-'}</p>
    </div>
  );
}
