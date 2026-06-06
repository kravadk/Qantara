import { motion, AnimatePresence } from 'framer-motion';
import { Bell, CheckCircle, XCircle, DollarSign, Unlock, ExternalLink, Check, RefreshCw, MessageSquare, KeyRound, AlertTriangle, Trash2 } from 'lucide-react';
import { Button } from '../../components/Button';
import { useNotifications, Notification } from '../../hooks/useNotifications';
import { notificationOperationalGroup } from '../../lib/qantaraApi';
import { qieMainnet } from '../../config/wagmi';
import { useNavigate } from 'react-router-dom';
import { useMemo, useState } from 'react';

function NotificationIcon({ type }: { type: Notification['type'] }) {
  switch (type) {
    case 'payment_received':
    case 'invoice_paid':
      return <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center"><DollarSign className="w-5 h-5 text-primary" /></div>;
    case 'invoice_settled':
    case 'receipt_created':
      return <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center"><CheckCircle className="w-5 h-5 text-blue-500" /></div>;
    case 'invoice_cancelled':
    case 'webhook_failed':
      return <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center"><XCircle className="w-5 h-5 text-red-500" /></div>;
    case 'invoice_message':
      return <div className="w-10 h-10 rounded-xl bg-secondary/10 flex items-center justify-center"><MessageSquare className="w-5 h-5 text-secondary" /></div>;
    case 'vesting_unlocked':
      return <div className="w-10 h-10 rounded-xl bg-yellow-500/10 flex items-center justify-center"><Unlock className="w-5 h-5 text-yellow-500" /></div>;
    default:
      return <div className="w-10 h-10 rounded-xl bg-surface-2 flex items-center justify-center"><Bell className="w-5 h-5 text-text-muted" /></div>;
  }
}

function formatTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(timestamp));
}

export function Notifications() {
  const {
    notifications,
    pagedNotifications,
    isLoading,
    unreadCount,
    errorMessage,
    setupRequired,
    walletRequired,
    canUseNotifications,
    pendingReadIds,
    pendingDismissIds,
    isMarkingAllRead,
    totalPages,
    page,
    setPage,
    markAsRead,
    markAllAsRead,
    dismiss,
    refetch,
  } = useNotifications();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<'all' | 'unread' | 'receipts' | 'webhooks'>('all');
  const [isRefreshing, setIsRefreshing] = useState(false);

  const operationalCounts = useMemo(() => {
    const counts = { receipt: 0, webhook: 0, message: 0, payment: 0 };
    for (const notification of notifications) {
      const group = notificationOperationalGroup(notification.type);
      if (group !== 'invoice') counts[group] += 1;
    }
    return counts;
  }, [notifications]);
  const source = filter === 'unread'
    ? notifications.filter(n => !n.read)
    : filter === 'receipts'
      ? notifications.filter(n => notificationOperationalGroup(n.type) === 'receipt')
      : filter === 'webhooks'
        ? notifications.filter(n => notificationOperationalGroup(n.type) === 'webhook')
        : pagedNotifications;
  const needsSetup = !canUseNotifications;

  const openNotification = (notif: Notification) => {
    void markAsRead(notif.id);
    const group = notificationOperationalGroup(notif.type);
    if (group === 'receipt') {
      navigate(`/app/inbox?tab=receipts&invoice=${encodeURIComponent(notif.invoiceHash)}`);
      return;
    }
    if (group === 'webhook') {
      navigate('/app/settings');
      return;
    }
    navigate(`/pay/${notif.invoiceHash}`);
  };

  const actionLabel = (notif: Notification) => {
    const group = notificationOperationalGroup(notif.type);
    if (group === 'receipt') return 'Open receipts';
    if (group === 'webhook') return 'Open settings';
    if (group === 'message') return 'Open invoice';
    return 'Open pay link';
  };

  const handleRefresh = async () => {
    if (needsSetup) return;
    setIsRefreshing(true);
    await refetch();
    setIsRefreshing(false);
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <h1 className="text-4xl font-bold text-white tracking-tight">Notifications</h1>
            {unreadCount > 0 && (
              <span className="px-2.5 py-1 text-xs font-bold bg-primary text-black rounded-full">
                {unreadCount}
              </span>
            )}
          </div>
          <p className="text-text-secondary">Backend, deal room, and payment events for your invoices</p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="gap-2"
            onClick={handleRefresh}
            disabled={needsSetup}
            loading={isRefreshing}
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </Button>
          {unreadCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => void markAllAsRead()}
              loading={isMarkingAllRead}
            >
              <Check className="w-4 h-4" />
              Mark all read
            </Button>
          )}
        </div>
      </div>

      {needsSetup && (
        <div className="rounded-2xl border border-yellow-400/20 bg-yellow-400/8 p-6">
          <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
            <div className="flex gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-yellow-400/10 text-yellow-300">
                {walletRequired ? <AlertTriangle className="h-5 w-5" /> : <KeyRound className="h-5 w-5" />}
              </div>
              <div className="space-y-1">
                <h2 className="text-lg font-bold text-white">
                  {walletRequired ? 'Connect wallet to load merchant notifications' : 'Merchant sign-in required'}
                </h2>
                <p className="max-w-2xl text-sm text-text-secondary">
                  {walletRequired
                    ? 'Notifications are scoped to the connected merchant address and backed by persisted backend events.'
                    : 'Notification read state and delivery events are authenticated backend resources. Sign in with the merchant wallet to enable them.'}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button variant="secondary" size="sm" onClick={() => navigate('/app/settings')}>
                Open settings
              </Button>
              <Button variant="secondary" size="sm" onClick={() => navigate('/app/guide')}>
                View setup guide
              </Button>
            </div>
          </div>
        </div>
      )}

      {!needsSetup && errorMessage && (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/8 p-4 text-sm text-red-200">
          Notifications could not be loaded: {errorMessage}
        </div>
      )}

      {/* Filter tabs */}
      {!needsSetup && <div className="flex items-center gap-2">
        {([
          ['all', `All (${notifications.length})`],
          ['unread', `Unread (${unreadCount})`],
          ['receipts', `Receipts (${operationalCounts.receipt})`],
          ['webhooks', `Webhooks (${operationalCounts.webhook})`],
        ] as const).map(([tab, label]) => (
          <button
            key={tab}
            onClick={() => {
              setFilter(tab);
              if (tab === 'all') setPage(0);
            }}
            className={`px-4 py-2 rounded-full text-xs font-bold uppercase tracking-widest transition-all ${
              filter === tab
                ? 'bg-primary text-black'
                : 'bg-surface-1 text-text-secondary border border-border-default hover:border-primary/40'
            }`}
          >
            {label}
          </button>
        ))}
      </div>}

      {!needsSetup && (
        <div className="grid gap-3 md:grid-cols-4">
          <SignalTile label="Unread" value={String(unreadCount)} tone={unreadCount > 0 ? 'warn' : 'good'} />
          <SignalTile label="Messages" value={String(operationalCounts.message)} />
          <SignalTile label="Receipts" value={String(operationalCounts.receipt)} />
          <SignalTile label="Webhook failures" value={String(operationalCounts.webhook)} tone={operationalCounts.webhook > 0 ? 'warn' : 'good'} />
        </div>
      )}

      {/* Notifications list */}
      {!needsSetup && <div className="space-y-3">
        {isLoading && notifications.length === 0 ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-20 bg-surface-1 rounded-2xl border border-border-default animate-pulse" />
            ))}
          </div>
        ) : source.length > 0 ? (
          <AnimatePresence mode="popLayout">
            {source.map((notif, index) => (
              <motion.div
                key={notif.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ delay: index * 0.03 }}
                onClick={() => openNotification(notif)}
                className={`flex items-start gap-4 p-5 rounded-2xl border cursor-pointer transition-all duration-200 group ${
                  notif.read
                    ? 'bg-surface-1 border-border-default hover:border-border-default/60'
                    : 'bg-surface-1 border-primary/20 hover:border-primary/40'
                }`}
              >
                <NotificationIcon type={notif.type} />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className={`text-sm font-bold ${notif.read ? 'text-text-secondary' : 'text-white'}`}>
                      {notif.title}
                    </h3>
                    {!notif.read && (
                      <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0" />
                    )}
                  </div>
                  <p className="text-xs text-text-muted mt-1 truncate">{notif.message}</p>
                  <div className="flex items-center gap-3 mt-2">
                    <span className="text-xs text-text-dim">{formatTimeAgo(notif.timestamp)}</span>
                    <span className="text-xs text-text-dim">Block {notif.blockNumber.toString()}</span>
                    {notif.txHash && (
                      <a
                        href={`${qieMainnet.blockExplorers.default.url}/tx/${notif.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        className="text-xs text-primary hover:underline flex items-center gap-1"
                      >
                        Explorer <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    )}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(event) => {
                      event.stopPropagation();
                      openNotification(notif);
                    }}
                  >
                    {actionLabel(notif)}
                  </Button>
                  {!notif.read && (
                    <button
                      type="button"
                      aria-label="Mark notification as read"
                      disabled={pendingReadIds.has(notif.id)}
                      onClick={(event) => {
                        event.stopPropagation();
                        void markAsRead(notif.id);
                      }}
                      className="rounded-lg border border-border-default bg-surface-2 p-2 text-text-muted transition-colors hover:border-primary/40 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label="Dismiss notification"
                    disabled={pendingDismissIds.has(notif.id)}
                    onClick={(event) => {
                      event.stopPropagation();
                      void dismiss(notif.id);
                    }}
                    className="rounded-lg border border-border-default bg-surface-2 p-2 text-text-muted transition-colors hover:border-red-500/40 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 bg-surface-1 rounded-2xl border border-border-default">
            <Bell className="w-12 h-12 text-text-dim mb-4" />
            <p className="text-lg font-bold text-text-muted">No notifications</p>
            <p className="text-sm text-text-dim mt-1">
              {filter === 'unread' ? 'All authenticated events are marked read.' : 'Persisted invoice, message, receipt, webhook, and payment events will appear here.'}
            </p>
          </div>
        )}
      </div>}

      {!needsSetup && filter === 'all' && totalPages > 1 && (
        <div className="flex items-center justify-between rounded-2xl border border-border-default bg-surface-1 px-4 py-3">
          <span className="text-xs text-text-muted">
            Page {page + 1} of {totalPages}
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" disabled={page === 0} onClick={() => setPage(Math.max(0, page - 1))}>
              Previous
            </Button>
            <Button variant="secondary" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(Math.min(totalPages - 1, page + 1))}>
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Source info */}
      {!needsSetup && <div className="flex items-center gap-2 px-2">
        <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
        <span className="text-xs text-text-dim uppercase tracking-widest">
          Live from backend events and QIE RPC verified payment state
        </span>
      </div>}
    </div>
  );
}

function SignalTile({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'warn' }) {
  return (
    <div className="rounded-2xl border border-border-default bg-surface-1 p-4">
      <div className="text-[10px] font-bold uppercase tracking-widest text-text-muted">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${tone === 'good' ? 'text-primary' : tone === 'warn' ? 'text-yellow-300' : 'text-white'}`}>{value}</div>
    </div>
  );
}
