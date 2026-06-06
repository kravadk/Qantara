import { useCallback, useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import {
  hasMerchantAuth,
  dismissNotification,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type BackendNotificationRecord,
} from '../lib/qantaraApi';

export interface Notification {
  id: string;
  type: 'invoice_created' | 'invoice_viewed' | 'invoice_paid' | 'invoice_message' | 'receipt_created' | 'webhook_failed' | 'payment_detected' | 'payment_received' | 'invoice_settled' | 'invoice_cancelled' | 'invoice_refunded' | 'invoice_paused' | 'invoice_resumed' | 'vesting_unlocked';
  title: string;
  message: string;
  invoiceHash: string;
  txHash?: string;
  blockNumber: bigint;
  timestamp: number;
  read: boolean;
}

function toNotification(record: BackendNotificationRecord): Notification {
  return {
    id: record.id,
    type: record.type as Notification['type'],
    title: record.title,
    message: record.message,
    invoiceHash: record.invoiceHash,
    txHash: record.txHash,
    blockNumber: BigInt(record.blockNumber),
    timestamp: record.timestamp,
    read: Boolean(record.readAt),
  };
}

export function useNotifications() {
  const { address } = useAccount();
  const merchantAuthConfigured = hasMerchantAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [pendingReadIds, setPendingReadIds] = useState<Set<string>>(new Set());
  const [pendingDismissIds, setPendingDismissIds] = useState<Set<string>>(new Set());
  const [isMarkingAllRead, setIsMarkingAllRead] = useState(false);
  const [page, setPage] = useState(0);
  const pageSize = 25;
  const canUseNotifications = Boolean(address && merchantAuthConfigured);

  const fetchNotifications = useCallback(async () => {
    if (!canUseNotifications) {
      setNotifications([]);
      setUnreadCount(0);
      setIsLoading(false);
      setErrorMessage(null);
      setPendingReadIds(new Set());
      setPendingDismissIds(new Set());
      setIsMarkingAllRead(false);
      return;
    }
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const result = await listNotifications({ merchant: address, limit: 200 });
      const next = result.notifications.map(toNotification).sort((a, b) => b.timestamp - a.timestamp);
      setNotifications(next);
      setUnreadCount(next.filter((notification) => !notification.read).length);
    } catch (error) {
      setNotifications([]);
      setUnreadCount(0);
      setErrorMessage(error instanceof Error ? error.message : 'Unable to load notifications');
    } finally {
      setIsLoading(false);
    }
  }, [address, canUseNotifications]);

  const markAsRead = useCallback(async (id: string) => {
    if (!address || !canUseNotifications || pendingReadIds.has(id)) return;
    setPendingReadIds((prev) => new Set(prev).add(id));
    setNotifications((prev) => {
      const next = prev.map((notification) => notification.id === id ? { ...notification, read: true } : notification);
      setUnreadCount(next.filter((notification) => !notification.read).length);
      return next;
    });
    try {
      await markNotificationRead(id, address);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to mark notification as read');
      await fetchNotifications();
    } finally {
      setPendingReadIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }, [address, canUseNotifications, fetchNotifications, pendingReadIds]);

  const markAllAsRead = useCallback(async () => {
    if (!address || !canUseNotifications || isMarkingAllRead) return;
    const ids = notifications.filter((notification) => !notification.read).map((notification) => notification.id);
    if (ids.length === 0) return;
    setIsMarkingAllRead(true);
    setNotifications((prev) => prev.map((notification) => ({ ...notification, read: true })));
    setUnreadCount(0);
    try {
      await markAllNotificationsRead(ids, address);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to mark notifications as read');
      await fetchNotifications();
    } finally {
      setIsMarkingAllRead(false);
    }
  }, [address, canUseNotifications, fetchNotifications, isMarkingAllRead, notifications]);

  const dismiss = useCallback(async (id: string) => {
    if (!address || !canUseNotifications || pendingDismissIds.has(id)) return;
    const current = notifications.find((notification) => notification.id === id);
    setPendingDismissIds((prev) => new Set(prev).add(id));
    setNotifications((prev) => {
      const next = prev.filter((notification) => notification.id !== id);
      setUnreadCount(next.filter((notification) => !notification.read).length);
      return next;
    });
    try {
      await dismissNotification(id, address);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to dismiss notification');
      if (current) await fetchNotifications();
    } finally {
      setPendingDismissIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }, [address, canUseNotifications, fetchNotifications, notifications, pendingDismissIds]);

  useEffect(() => {
    void fetchNotifications();
    if (!canUseNotifications) return undefined;
    const interval = window.setInterval(() => void fetchNotifications(), 5000);
    return () => window.clearInterval(interval);
  }, [canUseNotifications, fetchNotifications]);

  const totalCount = notifications.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const pagedNotifications = notifications.slice(safePage * pageSize, safePage * pageSize + pageSize);

  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage]);

  return {
    notifications,
    pagedNotifications,
    isLoading,
    errorMessage,
    unreadCount,
    merchantAuthConfigured,
    canUseNotifications,
    setupRequired: !merchantAuthConfigured,
    walletRequired: !address,
    pendingReadIds,
    pendingDismissIds,
    isMarkingAllRead,
    totalCount,
    totalPages,
    page: safePage,
    pageSize,
    setPage,
    markAsRead,
    markAllAsRead,
    dismiss,
    refetch: fetchNotifications,
  };
}
