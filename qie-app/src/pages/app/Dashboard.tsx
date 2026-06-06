import { motion } from 'framer-motion';
import { Clock, CheckCircle, XCircle, Lock, Share2, Plus, TrendingUp, MessageCircle, AlertTriangle, RefreshCw, ReceiptText, Users, Download } from 'lucide-react';
import { useState, useEffect, useMemo } from 'react';
import { Button } from '../../components/Button';
import type { Invoice } from '../../store/useInvoiceStore';
import { useAccount, useWriteContract, usePublicClient } from 'wagmi';
import { describeTxError } from '../../lib/walletErrors';
import { Link, useNavigate } from 'react-router-dom';
import { CipherScramble } from '../../components/CipherScramble';
import { useToastStore } from '../../components/ToastContainer';
import { useContractStatus } from '../../hooks/useContractStatus';
import { useInvoices } from '../../hooks/useInvoices';
import { SideDrawer } from '../../components/SideDrawer';
import { InvoiceActionMenu } from '../../components/ProductOps';
import { useNotifications } from '../../hooks/useNotifications';
import {
  refundInvoice as apiRefundInvoice,
  verifyContractRefund,
  hasMerchantAuth,
  verifyLifecycleAction,
  MerchantAuthMissingError,
  listReceipts,
  listWebhookDeliveries,
  retryWebhookDelivery,
  isFailedWebhookDelivery,
  tokenSymbol,
  type ReceiptRecord,
  type WebhookDeliveryRecord,
} from '../../lib/qantaraApi';
import { qantaraAbi, erc20ApproveAbi } from '../../lib/qantaraAbi';
import { QANTARA_ADDRESS, QUSDC_ADDRESS } from '../../lib/dealRoom';
import { qieMainnet } from '../../config/wagmi';
import { parseEther, parseUnits, type Hex } from 'viem';

function CountUpAnimation({ value, duration = 1500 }: { value: number; duration?: number }) {
  const [displayed, setDisplayed] = useState(0);

  useEffect(() => {
    if (value === 0) return;
    const start = Date.now();
    const animate = () => {
      const elapsed = Date.now() - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // easeOut
      setDisplayed(Math.round(value * eased));
      if (progress < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }, [value, duration]);

  return <>{displayed}</>;
}

export function Dashboard() {
  const { invoices, rawInvoices, isLoading: isLoadingInvoices, refetch: refetchInvoices } = useInvoices();
  const { notifications, unreadCount, merchantAuthConfigured: notificationsMerchantAuthConfigured, canUseNotifications } = useNotifications();
  const { address } = useAccount();
  const { addToast } = useToastStore();
  const { isDeployed } = useContractStatus();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'all' | 'sender' | 'receiver' | 'recurring' | 'batch'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'settled' | 'cancelled' | 'needs-reply' | 'receipt-ready' | 'receipt-pending' | 'expiring' | 'webhook-failed'>('all');
  const [drawerInvoice, setDrawerInvoice] = useState<Invoice | null>(null);
  const [receipts, setReceipts] = useState<ReceiptRecord[]>([]);
  const [webhookDeliveries, setWebhookDeliveries] = useState<WebhookDeliveryRecord[]>([]);
  const [webhookDeliveryTotal, setWebhookDeliveryTotal] = useState(0);
  const [opsLoading, setOpsLoading] = useState(false);
  const [opsError, setOpsError] = useState<string | null>(null);
  const [retryingDeliveryId, setRetryingDeliveryId] = useState<string | null>(null);

  const merchantAddress = address?.toLowerCase();
  const merchantInvoices = rawInvoices.filter((invoice) => invoice.merchant.toLowerCase() === merchantAddress);
  const receiptHashes = useMemo(
    () => new Set(receipts.map((receipt) => receipt.invoiceHash.toLowerCase())),
    [receipts],
  );
  const unreadMessagesByInvoice = useMemo(() => {
    const map = new Map<string, number>();
    for (const notification of notifications) {
      if (notification.read || notification.type !== 'invoice_message') continue;
      const key = notification.invoiceHash.toLowerCase();
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [notifications]);
  const latestEventByInvoice = useMemo(() => {
    const map = new Map<string, typeof notifications[number]>();
    for (const notification of notifications) {
      const key = notification.invoiceHash.toLowerCase();
      const existing = map.get(key);
      if (!existing || notification.timestamp > existing.timestamp) map.set(key, notification);
    }
    return map;
  }, [notifications]);
  const failedWebhookByInvoice = useMemo(() => {
    const map = new Map<string, WebhookDeliveryRecord>();
    for (const delivery of webhookDeliveries) {
      if (!isFailedWebhookDelivery(delivery)) continue;
      const key = delivery.invoiceHash.toLowerCase();
      const existing = map.get(key);
      if (!existing || delivery.updatedAt > existing.updatedAt) map.set(key, delivery);
    }
    return map;
  }, [webhookDeliveries]);

  const totalCount = invoices.length;
  const pendingCount = invoices.filter(i => i.status === 'open').length;
  const settledCount = invoices.filter(i => i.status === 'settled').length;
  const cancelledCount = invoices.filter(i => i.status === 'cancelled').length;
  const settleRate = totalCount > 0 ? Math.round((settledCount / totalCount) * 100) : 0;

  const volumeByToken = invoices
    .filter(i => i.status === 'settled' && typeof i.amount === 'string' && /^[0-9.]+$/.test(i.amount))
    .reduce<Record<'QIE' | 'QUSDC', number>>((sum, i) => {
      sum[i.token ?? 'QIE'] += Number(i.amount);
      return sum;
    }, { QIE: 0, QUSDC: 0 });
  const volumeSummary = Object.entries(volumeByToken)
    .filter(([, value]) => value > 0)
    .map(([token, value]) => `${value.toFixed(value % 1 === 0 ? 0 : 2)} ${token}`)
    .join(' / ');

  const stats = [
    { label: 'Total Invoices', value: totalCount, trend: totalCount > 3 ? `+${Math.min(totalCount, 5)} this week` : null, color: 'text-white' },
    { label: 'Pending', value: pendingCount, trend: pendingCount > 0 ? 'Awaiting payment' : 'All clear', color: 'text-secondary' },
    { label: 'Paid', value: settledCount, trend: settleRate > 0 ? `${settleRate}% paid` : null, color: 'text-primary' },
    { label: 'Volume', value: volumeSummary || '0', trend: volumeSummary ? 'lifetime received' : 'no payments yet', color: 'text-blue-400' },
  ];

  const expiringSoon = merchantInvoices.filter((invoice) =>
    invoice.status === 0 &&
    invoice.expiresAt > 0 &&
    invoice.expiresAt - Math.floor(Date.now() / 1000) < 86400,
  );
  const paidWaitingReceipt = merchantInvoices.filter((invoice) =>
    invoice.status === 1 && !receiptHashes.has(invoice.hash.toLowerCase()),
  );
  const failedWebhookInvoices = merchantInvoices.filter((invoice) => failedWebhookByInvoice.has(invoice.hash.toLowerCase()));
  const needsReplyInvoices = merchantInvoices.filter((invoice) => unreadMessagesByInvoice.has(invoice.hash.toLowerCase()));
  const openMerchantInvoices = merchantInvoices.filter((invoice) => invoice.status === 0);
  const needsAttention: Array<{
    invoice: typeof merchantInvoices[number];
    label: string;
    detail: string;
    icon: typeof MessageCircle;
    tone: string;
    action: 'reply' | 'retry-webhook' | 'view-receipt' | 'share';
    delivery?: WebhookDeliveryRecord;
  }> = [
    ...needsReplyInvoices.slice(0, 2).map((invoice) => ({
      invoice,
      label: 'Needs reply',
      detail: `${unreadMessagesByInvoice.get(invoice.hash.toLowerCase()) ?? 0} unread message event${(unreadMessagesByInvoice.get(invoice.hash.toLowerCase()) ?? 0) === 1 ? '' : 's'}`,
      icon: MessageCircle,
      tone: 'text-primary',
      action: 'reply' as const,
    })),
    ...failedWebhookInvoices.slice(0, 2).map((invoice) => ({
      invoice,
      label: 'Webhook failed',
      detail: failedWebhookByInvoice.get(invoice.hash.toLowerCase())?.lastError || 'Delivery needs retry',
      icon: AlertTriangle,
      tone: 'text-red-300',
      action: 'retry-webhook' as const,
      delivery: failedWebhookByInvoice.get(invoice.hash.toLowerCase()),
    })),
    ...paidWaitingReceipt.slice(0, 2).map((invoice) => ({
      invoice,
      label: 'Receipt pending',
      detail: 'Paid invoice has no persisted receipt yet',
      icon: ReceiptText,
      tone: 'text-yellow-300',
      action: 'view-receipt' as const,
    })),
    ...merchantInvoices.filter((invoice) => receiptHashes.has(invoice.hash.toLowerCase())).slice(0, 2).map((invoice) => ({
      invoice,
      label: 'Receipt ready',
      detail: 'Persisted receipt is available for this payment',
      icon: ReceiptText,
      tone: 'text-primary',
      action: 'view-receipt' as const,
    })),
    ...expiringSoon.slice(0, 2).map((invoice) => ({
      invoice,
      label: 'Expires soon',
      detail: 'Share, follow up, or cancel before expiry',
      icon: AlertTriangle,
      tone: 'text-yellow-300',
      action: 'share' as const,
    })),
    ...openMerchantInvoices.slice(0, 2).map((invoice) => ({
      invoice,
      label: 'Awaiting payment',
      detail: 'Copy the pay link or open the deal room',
      icon: Clock,
      tone: 'text-secondary',
      action: 'share' as const,
    })),
  ].filter((item, index, all) => all.findIndex((other) => other.invoice.hash === item.invoice.hash) === index).slice(0, 6);

  const customerSummaries = useMemo(() => {
    const map = new Map<string, {
      payer: string;
      invoices: number;
      paid: number;
      open: number;
      refunded: number;
      volume: Record<'QIE' | 'QUSDC', number>;
      lastSeen: number;
    }>();
    for (const invoice of merchantInvoices) {
      if (!invoice.payer) continue;
      const key = invoice.payer.toLowerCase();
      const existing = map.get(key) ?? {
        payer: invoice.payer,
        invoices: 0,
        paid: 0,
        open: 0,
        refunded: 0,
        volume: { QIE: 0, QUSDC: 0 },
        lastSeen: 0,
      };
      existing.invoices += 1;
      if (invoice.status === 1) existing.paid += 1;
      if (invoice.status === 0) existing.open += 1;
      if (invoice.status === 3) existing.refunded += 1;
      if (invoice.status === 1 && /^[0-9.]+$/.test(invoice.amount)) {
        existing.volume[tokenSymbol(invoice.token)] += Number(invoice.amount);
      }
      existing.lastSeen = Math.max(existing.lastSeen, invoice.paidAt ?? invoice.createdAt);
      map.set(key, existing);
    }
    return Array.from(map.values()).sort((a, b) => b.lastSeen - a.lastSeen).slice(0, 6);
  }, [merchantInvoices]);

  const exportMerchantInvoicesCsv = () => {
    const header = ['Hash', 'Status', 'Amount', 'Token', 'Merchant', 'Payer', 'Created', 'PaidTxHash'];
    const rows = merchantInvoices.map((invoice) => [
      invoice.hash,
      invoice.status,
      invoice.amount,
      tokenSymbol(invoice.token),
      invoice.merchant,
      invoice.payer ?? '',
      new Date(invoice.createdAt * 1000).toISOString(),
      invoice.paidTxHash ?? '',
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Qantara-invoices.csv';
    a.click();
    URL.revokeObjectURL(url);
    addToast('success', 'CSV exported');
  };

  const exportMerchantInvoicesJson = () => {
    const blob = new Blob([JSON.stringify({ invoices: merchantInvoices }, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Qantara-invoices.json';
    a.click();
    URL.revokeObjectURL(url);
    addToast('success', 'JSON exported');
  };

  useEffect(() => {
    let cancelled = false;
    const loadMerchantOps = async () => {
      if (!address || !hasMerchantAuth()) {
        setReceipts([]);
        setWebhookDeliveries([]);
        setWebhookDeliveryTotal(0);
        setOpsError(null);
        setOpsLoading(false);
        return;
      }
      setOpsLoading(true);
      setOpsError(null);
      try {
        const [receiptResult, webhookResult] = await Promise.all([
          listReceipts({ merchant: address, limit: 200 }),
          listWebhookDeliveries({ limit: 200 }),
        ]);
        if (!cancelled) {
          setReceipts(receiptResult.receipts);
          setWebhookDeliveries(webhookResult.deliveries);
          setWebhookDeliveryTotal(webhookResult.total ?? webhookResult.count ?? webhookResult.deliveries.length);
        }
      } catch (err) {
        if (!cancelled) {
          setReceipts([]);
          setWebhookDeliveries([]);
          setWebhookDeliveryTotal(0);
          setOpsError(err instanceof Error ? err.message : 'Merchant operations unavailable');
        }
      } finally {
        if (!cancelled) setOpsLoading(false);
      }
    };
    void loadMerchantOps();
    const interval = window.setInterval(() => void loadMerchantOps(), 10000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [address]);

  const filteredInvoices = invoices.filter(invoice => {
    // Role filter
    if (activeTab === 'sender' && invoice.creator?.toLowerCase() !== address?.toLowerCase()) return false;
    if (activeTab === 'receiver' && invoice.creator?.toLowerCase() === address?.toLowerCase()) return false;
    if (activeTab === 'recurring' && invoice.type !== 'recurring') return false;
    if (activeTab === 'batch' && invoice.type !== 'batch') return false;
    // Status filter
    if (statusFilter === 'needs-reply' && !unreadMessagesByInvoice.has(invoice.hash.toLowerCase())) return false;
    if (statusFilter === 'receipt-ready' && !receiptHashes.has(invoice.hash.toLowerCase())) return false;
    if (statusFilter === 'receipt-pending' && !(invoice.status === 'settled' && !receiptHashes.has(invoice.hash.toLowerCase()))) return false;
    if (statusFilter === 'expiring' && !(invoice.status === 'open' && invoice.deadline && invoice.deadline - Math.floor(Date.now() / 1000) < 86400)) return false;
    if (statusFilter === 'webhook-failed' && !failedWebhookByInvoice.has(invoice.hash.toLowerCase())) return false;
    if (['open', 'settled', 'cancelled'].includes(statusFilter) && invoice.status !== statusFilter) return false;
    return true;
  }).slice(0, 10);

  const statusFilterOptions: Array<{ id: typeof statusFilter; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'open', label: 'Open' },
    { id: 'settled', label: 'Paid' },
    { id: 'needs-reply', label: 'Needs reply' },
    { id: 'receipt-ready', label: 'Receipt ready' },
    { id: 'receipt-pending', label: 'Receipt pending' },
    { id: 'expiring', label: 'Expiring' },
    { id: 'webhook-failed', label: 'Webhook failed' },
    { id: 'cancelled', label: 'Cancelled' },
  ];

  const getOperationalState = (invoice: Invoice) => {
    const key = invoice.hash.toLowerCase();
    const latestEvent = latestEventByInvoice.get(key);
    if (unreadMessagesByInvoice.has(key)) {
      return {
        label: 'Reply',
        detail: `${unreadMessagesByInvoice.get(key)} unread`,
        tone: 'text-primary',
      };
    }
    if (failedWebhookByInvoice.has(key)) {
      return {
        label: 'Retry webhook',
        detail: failedWebhookByInvoice.get(key)?.eventType ?? 'delivery failed',
        tone: 'text-red-300',
      };
    }
    if (invoice.status === 'settled' && receiptHashes.has(key)) {
      return { label: 'View receipt', detail: 'receipt ready', tone: 'text-primary' };
    }
    if (invoice.status === 'settled') {
      return { label: 'Receipt pending', detail: 'verified payment', tone: 'text-yellow-300' };
    }
    if (invoice.status === 'open' && invoice.deadline && invoice.deadline - Math.floor(Date.now() / 1000) < 86400) {
      return { label: 'Follow up', detail: 'expires soon', tone: 'text-yellow-300' };
    }
    if (latestEvent) {
      const eventDate = new Date(latestEvent.timestamp);
      const hh = String(eventDate.getHours()).padStart(2, '0');
      const mm = String(eventDate.getMinutes()).padStart(2, '0');
      return { label: latestEvent.type.replaceAll('_', ' '), detail: `${hh}:${mm}`, tone: 'text-text-secondary' };
    }
    if (invoice.status === 'open') {
      return { label: 'Share', detail: 'awaiting payment', tone: 'text-secondary' };
    }
    return { label: 'Review', detail: invoice.status, tone: 'text-text-secondary' };
  };

  const handleCopyHash = (hash: string) => {
    navigator.clipboard.writeText(hash);
    addToast('success', 'Hash copied');
  };

  const handleShareLink = (hash: string) => {
    navigator.clipboard.writeText(`${window.location.origin}/pay/${hash}`);
    addToast('success', 'Payment link copied');
  };

  const handleRetryWebhook = async (delivery: WebhookDeliveryRecord | undefined) => {
    if (!delivery) {
      addToast('warning', 'Webhook delivery record is no longer in the current backend result');
      return;
    }
    setRetryingDeliveryId(delivery.id);
    try {
      const result = await retryWebhookDelivery(delivery.id);
      setWebhookDeliveries((items) => items.map((item) => item.id === delivery.id ? result.delivery : item));
      addToast('success', 'Webhook retry submitted');
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : 'Webhook retry failed');
    } finally {
      setRetryingDeliveryId(null);
    }
  };

  const openReceiptView = (hash: string) => {
    navigate(`/app/inbox?tab=receipts&invoice=${encodeURIComponent(hash)}`);
  };

  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();

  const handleUnsupportedAction = (label: string) => {
    addToast('warning', `${label} requires an on-chain invoice and the deployed Qantara contract method.`);
  };

  /** Decide whether an invoice was created on-chain (then merchant actions go through the contract). */
  const isOnChainInvoice = (hash: string): boolean => {
    const inv = rawInvoices.find((i) => i.hash.toLowerCase() === hash.toLowerCase());
    return Boolean(inv?.metadata && (inv.metadata as Record<string, unknown>).chain_tx_hash) && Boolean(QANTARA_ADDRESS);
  };

  /** Call a write method on the deployed invoice contract, wait for the receipt, then mirror the verified tx through the backend. */
  const runContractAction = async (
    hash: string,
    label: string,
    contractMethod: 'cancelInvoice' | 'pauseInvoice' | 'resumeInvoice',
  ) => {
    if (!address) {
      addToast('warning', `${label} requires a connected wallet`);
      return;
    }
    try {
      addToast('info', `${label} on-chain — confirm in wallet`);
      const tx = await writeContractAsync({
        account: address,
        chain: qieMainnet,
        address: QANTARA_ADDRESS!,
        abi: qantaraAbi,
        functionName: contractMethod,
        args: [hash as Hex],
      } as any);
      addToast('info', `Tx ${tx.slice(0, 10)}… submitted`);
      await publicClient!.waitForTransactionReceipt({ hash: tx });
      addToast('success', `${label} confirmed on-chain`);
      if (hasMerchantAuth()) {
        const action = contractMethod === 'cancelInvoice'
          ? 'cancel'
          : contractMethod === 'pauseInvoice'
            ? 'pause'
            : 'resume';
        await verifyLifecycleAction(hash, action, tx);
      }
      await refetchInvoices();
    } catch (err) {
      const info = describeTxError(err);
      addToast(info.kind === 'rejected' ? 'info' : 'error', info.message);
    }
  };

  /** On-chain refund: merchant deposits funds back into the contract, payer pulls via withdrawRefund. */
  const runRefundContractAction = async (hash: string) => {
    if (!address) return addToast('warning', 'Refund requires a connected wallet');
    const inv = rawInvoices.find((i) => i.hash.toLowerCase() === hash.toLowerCase());
    if (!inv) return addToast('error', 'Invoice not found in the current backend result');
    if (inv.status !== 1) return addToast('warning', 'Only Paid invoices can be refunded');

    const tokenAddr = inv.token.toLowerCase();
    const isNative = tokenAddr === '0x0000000000000000000000000000000000000000';
    try {
      if (isNative) {
        const value = parseEther(inv.amount);
        addToast('info', `Refund ${inv.amount} QIE — confirm in wallet`);
        const tx = await writeContractAsync({
          account: address,
          chain: qieMainnet,
          address: QANTARA_ADDRESS!,
          abi: qantaraAbi,
          functionName: 'refundInvoice',
          args: [hash as Hex],
          value,
        } as any);
        await publicClient!.waitForTransactionReceipt({ hash: tx });
        addToast('success', `Refund confirmed (tx ${tx.slice(0, 10)}…)`);
        if (hasMerchantAuth()) await verifyContractRefund(hash, tx);
      } else {
        // QUSDC: approve the invoice contract, then refundInvoice (no value, contract pulls)
        if (!QUSDC_ADDRESS) return addToast('error', 'QUSDC address not configured');
        const value = parseUnits(inv.amount, 6);
        const allowance = (await (publicClient as any).readContract({
          address: QUSDC_ADDRESS,
          abi: erc20ApproveAbi,
          functionName: 'allowance',
          args: [address, QANTARA_ADDRESS!],
        })) as bigint;
        if (allowance < value) {
          addToast('info', 'Step 1/2: approve QUSDC for refund');
          const ap = await writeContractAsync({
            account: address,
            chain: qieMainnet,
            address: QUSDC_ADDRESS,
            abi: erc20ApproveAbi,
            functionName: 'approve',
            args: [QANTARA_ADDRESS!, value],
          } as any);
          await publicClient!.waitForTransactionReceipt({ hash: ap });
        }
        addToast('info', 'Step 2/2: confirm refundInvoice');
        const tx = await writeContractAsync({
          account: address,
          chain: qieMainnet,
          address: QANTARA_ADDRESS!,
          abi: qantaraAbi,
          functionName: 'refundInvoice',
          args: [hash as Hex],
        } as any);
        await publicClient!.waitForTransactionReceipt({ hash: tx });
        addToast('success', `Refund confirmed (tx ${tx.slice(0, 10)}…)`);
        if (hasMerchantAuth()) await verifyContractRefund(hash, tx);
      }
      await refetchInvoices();
    } catch (err) {
      const info = describeTxError(err);
      addToast(info.kind === 'rejected' ? 'info' : 'error', info.message);
    }
  };

  /** Run a merchant API action with consistent error handling + toast feedback. */
  const runMerchantAction = async (
    hash: string,
    label: string,
    fn: (hash: string) => Promise<unknown>,
  ) => {
    if (!hasMerchantAuth()) {
      addToast('warning', `${label} requires merchant wallet sign-in or indexed on-chain confirmation.`);
      return;
    }
    try {
      addToast('info', `${label}…`);
      await fn(hash);
      addToast('success', `${label} completed.`);
      await refetchInvoices();
    } catch (err) {
      if (err instanceof MerchantAuthMissingError) {
        addToast('warning', err.message);
        return;
      }
      const msg = err instanceof Error ? err.message : 'Action failed';
      addToast('error', msg);
    }
  };

  const handleCancel = (hash: string) =>
    isOnChainInvoice(hash)
      ? runContractAction(hash, 'Cancel invoice', 'cancelInvoice')
      : handleUnsupportedAction('Cancel invoice');
  const handlePause = (hash: string) =>
    isOnChainInvoice(hash)
      ? runContractAction(hash, 'Pause invoice', 'pauseInvoice')
      : handleUnsupportedAction('Pause invoice');
  const handleResume = (hash: string) =>
    isOnChainInvoice(hash)
      ? runContractAction(hash, 'Resume invoice', 'resumeInvoice')
      : handleUnsupportedAction('Resume invoice');
  const handleRefund = (hash: string) =>
    isOnChainInvoice(hash)
      ? runRefundContractAction(hash)
      : runMerchantAction(hash, 'Refund invoice', apiRefundInvoice);

  const statusIcon = (status: string) => {
    switch (status) {
      case 'settled': return <CheckCircle className="w-4 h-4 text-primary" />;
      case 'open': return <Clock className="w-4 h-4 text-secondary" />;
      case 'cancelled': return <XCircle className="w-4 h-4 text-text-muted" />;
      case 'locked': return <Lock className="w-4 h-4 text-yellow-500" />;
      case 'paused': return <Clock className="w-4 h-4 text-orange-500" />;
      default: return null;
    }
  };

  const statusColor = (status: string) => {
    switch (status) {
      case 'settled': return 'text-primary';
      case 'open': return 'text-secondary';
      case 'cancelled': return 'text-text-muted';
      case 'locked': return 'text-yellow-500';
      case 'paused': return 'text-orange-500';
      default: return 'text-text-muted';
    }
  };

  const typeColor = (type: string) => {
    switch (type) {
      case 'standard': return 'bg-primary/10 border-primary/20 text-primary';
      case 'multi-pay': return 'bg-blue-500/10 border-blue-500/20 text-blue-500';
      case 'recurring': return 'bg-purple-500/10 border-purple-500/20 text-purple-500';
      case 'vesting': return 'bg-yellow-500/10 border-yellow-500/20 text-yellow-500';
      case 'batch': return 'bg-orange-500/10 border-orange-500/20 text-orange-500';
      default: return 'bg-surface-2 border-border-default text-text-muted';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3 p-3 rounded-xl bg-primary/5 border border-primary/20 text-xs">
        <div className="w-1.5 h-1.5 rounded-full bg-primary mt-1 shrink-0 animate-pulse" />
        <div className="flex-1 text-primary/90">
          Invoices are loaded from the configured backend API. Payment status is updated only after QIE RPC verifies a real transaction.
        </div>
      </div>

      {/* Qantara Hero */}
      <div className="relative overflow-hidden rounded-2xl border border-primary/25 bg-gradient-to-br from-secondary/10 via-surface-1 to-surface-1 p-6 md:p-8">
        <div className="qie-mesh-bg absolute inset-0 opacity-40 pointer-events-none" />
        <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-2">
              <span
                className="text-[10px] font-bold uppercase tracking-widest text-white px-2 py-0.5 rounded"
                style={{ background: 'linear-gradient(90deg, #7e22ce 0%, #F02C78 100%)' }}
              >QIE Mainnet · chain 1990</span>
              <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded ${isDeployed ? 'bg-primary/15 text-primary border border-primary/30' : 'bg-blue-500/10 text-blue-300'}`}>{isDeployed ? 'connected' : 'backend'}</span>
            </div>
            <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight">
              {totalCount === 0
                ? <>Create your first <span className="qie-gradient-text-anim">Qantara invoice</span></>
                : <>{totalCount} <span className="qie-gradient-text-anim">invoice{totalCount === 1 ? '' : 's'}</span> on chain</>}
            </h1>
            <p className="text-sm text-text-secondary max-w-lg">
              Non-custodial payment links and QR invoices. Pay in native <span className="text-white font-bold">QIE</span> or <span className="text-white font-bold">QUSDC</span> stablecoin. Settlement is on-chain and verifiable.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row md:flex-col gap-2 shrink-0">
            <Link to="/app/new-cipher">
              <Button variant="primary" className="w-full md:w-auto gap-2 px-6">
                <Plus className="w-4 h-4" /> Create invoice
              </Button>
            </Link>
            <Link to="/app/explorer">
              <Button variant="secondary" className="w-full md:w-auto gap-2 px-6">
                <TrendingUp className="w-4 h-4" /> View Explorer
              </Button>
            </Link>
          </div>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
        {stats.map((stat, i) => (
          <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
            className="bg-surface-1 border border-border-default rounded-2xl p-6 space-y-3 hover:border-primary/20 transition-colors">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-text-secondary uppercase tracking-widest">{stat.label}</p>
              {i === 0 && <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />}
            </div>
            <div className="flex items-baseline gap-2">
              <span className={`text-3xl font-bold ${(stat as any).color || 'text-white'}`}>
                {typeof stat.value === 'number' ? <CountUpAnimation value={stat.value} /> : stat.value}
              </span>
            </div>
            {(stat as any).trend && (
              <p className="text-xs text-text-secondary">{(stat as any).trend}</p>
            )}
            {/* Mini progress bar for settle rate */}
            {stat.label === 'Paid' && totalCount > 0 && (
              <div className="w-full h-1 bg-surface-3 rounded-full overflow-hidden">
                <motion.div initial={{ width: 0 }} animate={{ width: `${settleRate}%` }}
                  transition={{ duration: 1, delay: 0.5 }} className="h-full bg-primary rounded-full" />
              </div>
            )}
          </motion.div>
        ))}
      </div>

      <section className="rounded-2xl border border-border-default bg-surface-1 p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-white">Needs attention</h2>
            <p className="text-xs text-text-muted">Real invoice events, receipt state, webhook delivery state, and next best actions.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 rounded-full border border-border-default bg-surface-2 px-3 py-1.5 text-xs text-text-secondary">
              <MessageCircle className="h-3.5 w-3.5 text-primary" />
              {canUseNotifications ? `${unreadCount} unread` : notificationsMerchantAuthConfigured ? 'Connect wallet' : 'auth required'}
            </div>
            <div className="flex items-center gap-2 rounded-full border border-border-default bg-surface-2 px-3 py-1.5 text-xs text-text-secondary">
              <CheckCircle className="h-3.5 w-3.5 text-primary" />
              {opsLoading ? 'Loading ops' : `${receipts.length} receipts`}
            </div>
            <div className="flex items-center gap-2 rounded-full border border-border-default bg-surface-2 px-3 py-1.5 text-xs text-text-secondary">
              <AlertTriangle className="h-3.5 w-3.5 text-yellow-300" />
              {hasMerchantAuth()
                ? `${failedWebhookByInvoice.size} webhook issues / ${webhookDeliveryTotal} checked`
                : 'auth required'}
            </div>
          </div>
        </div>
        {opsError && (
          <div className="mb-4 rounded-xl border border-yellow-500/25 bg-yellow-500/5 px-4 py-3 text-xs text-yellow-200">
            Merchant operations could not load: {opsError}
          </div>
        )}
        {needsAttention.length > 0 ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {needsAttention.map(({ invoice, label, detail, icon: Icon, tone, action, delivery }) => (
              <div key={`${label}-${invoice.hash}`} className="rounded-xl border border-border-default bg-surface-2 p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Icon className={`h-4 w-4 ${tone}`} />
                    <span className="text-sm font-bold text-white">{invoice.title || invoice.memo || invoice.hash.slice(0, 12)}</span>
                  </div>
                  <span className="rounded-full bg-primary/10 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-primary">{label}</span>
                </div>
                <p className="mb-3 line-clamp-2 text-xs text-text-muted">{detail}</p>
                <div className="flex flex-wrap gap-2">
                  {action === 'reply' && (
                    <Button variant="secondary" size="sm" className="gap-2" onClick={() => setDrawerInvoice(toLegacyInvoiceSafe(invoice))}>
                      <MessageCircle className="h-4 w-4" /> Reply
                    </Button>
                  )}
                  {action === 'retry-webhook' && (
                    <Button
                      variant="secondary"
                      size="sm"
                      className="gap-2 text-red-200"
                      loading={retryingDeliveryId === delivery?.id}
                      onClick={() => void handleRetryWebhook(delivery)}
                    >
                      <RefreshCw className="h-4 w-4" /> Retry webhook
                    </Button>
                  )}
                  {action === 'view-receipt' && (
                    <Button variant="secondary" size="sm" className="gap-2" onClick={() => openReceiptView(invoice.hash)}>
                      <ReceiptText className="h-4 w-4" /> Receipts
                    </Button>
                  )}
                  {action === 'share' && (
                    <Button variant="secondary" size="sm" className="gap-2" onClick={() => handleShareLink(invoice.hash)}>
                      <Share2 className="h-4 w-4" /> Copy pay link
                    </Button>
                  )}
                  <InvoiceActionMenu invoice={invoice} onReply={action === 'reply' ? undefined : () => setDrawerInvoice(toLegacyInvoiceSafe(invoice))} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border-default bg-surface-2 p-6 text-center text-sm text-text-muted">
            {hasMerchantAuth()
              ? 'No urgent invoice actions. New messages, failed webhooks, missing receipts, and expiring links will appear here.'
              : 'Sign in with the merchant wallet to enable authenticated receipt and webhook action signals.'}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-border-default bg-surface-1 p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-white">Customers / payers</h2>
            <p className="text-xs text-text-muted">Derived from backend invoice records for the connected merchant wallet.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={exportMerchantInvoicesCsv} disabled={merchantInvoices.length === 0} className="inline-flex items-center gap-2 rounded-full border border-border-default bg-surface-2 px-3 py-2 text-xs font-bold uppercase tracking-widest text-text-muted transition-colors hover:text-primary disabled:cursor-not-allowed disabled:opacity-50">
              <Download className="h-3.5 w-3.5" /> CSV
            </button>
            <button onClick={exportMerchantInvoicesJson} disabled={merchantInvoices.length === 0} className="inline-flex items-center gap-2 rounded-full border border-border-default bg-surface-2 px-3 py-2 text-xs font-bold uppercase tracking-widest text-text-muted transition-colors hover:text-primary disabled:cursor-not-allowed disabled:opacity-50">
              <Download className="h-3.5 w-3.5" /> JSON
            </button>
          </div>
        </div>
        {customerSummaries.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border-default bg-surface-2 p-6 text-center text-sm text-text-muted">
            <Users className="mx-auto mb-3 h-8 w-8 text-text-dim" />
            Payer records appear after invoices are addressed or paid by a wallet.
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {customerSummaries.map((customer) => {
              const volume = Object.entries(customer.volume)
                .filter(([, value]) => value > 0)
                .map(([symbol, value]) => `${value.toFixed(value % 1 === 0 ? 0 : 2)} ${symbol}`)
                .join(' / ') || '0';
              return (
                <div key={customer.payer} className="rounded-xl border border-border-default bg-surface-2 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-sm text-white">{customer.payer.slice(0, 10)}...{customer.payer.slice(-8)}</p>
                      <p className="mt-1 text-xs text-text-muted">Last activity {new Date(customer.lastSeen * 1000).toLocaleString()}</p>
                    </div>
                    <a href={`${qieMainnet.blockExplorers.default.url}/address/${customer.payer}`} target="_blank" rel="noreferrer" className="text-xs font-bold uppercase tracking-widest text-text-muted hover:text-primary">
                      Explorer
                    </a>
                  </div>
                  <div className="mt-4 grid grid-cols-4 gap-2 text-center text-xs">
                    <Metric label="Invoices" value={String(customer.invoices)} />
                    <Metric label="Paid" value={String(customer.paid)} />
                    <Metric label="Open" value={String(customer.open)} />
                    <Metric label="Volume" value={volume} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Recent Invoices */}
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            <h2 className="text-xl font-bold text-white uppercase tracking-tight">Recent Invoices</h2>
          </div>
          <div className="flex items-center gap-4">
            {invoices.length > 0 && (
              <button
                onClick={exportMerchantInvoicesCsv}
                className="text-xs text-text-muted hover:text-primary transition-colors uppercase tracking-widest"
              >
                Export CSV
              </button>
            )}
            <Link to="/app/explorer" className="text-xs font-bold text-primary hover:underline uppercase tracking-widest">
              View All Explorer &gt;
            </Link>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-6">
          {/* Role filter */}
          <div className="flex items-center gap-1.5 bg-surface-1 border border-border-default rounded-xl p-1">
            {(['all', 'sender', 'receiver'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
                  activeTab === tab ? 'bg-primary text-black' : 'text-text-secondary hover:text-white hover:bg-surface-2'
                }`}
              >
                {tab === 'all' ? 'All' : tab === 'sender' ? 'Sent' : 'Received'}
              </button>
            ))}
          </div>
          {/* Status filter */}
          <div className="flex items-center gap-1.5 bg-surface-1 border border-border-default rounded-xl p-1">
            {statusFilterOptions.map((status) => (
              <button
                key={status.id}
                onClick={() => setStatusFilter(status.id)}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
                  statusFilter === status.id ? 'bg-primary text-black' : 'text-text-secondary hover:text-white hover:bg-surface-2'
                }`}
              >
                {status.label}
            </button>
          ))}
          </div>
        </div>

        <div className="bg-surface-1 border border-border-default rounded-[32px] overflow-hidden">
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-border-default">
                  <th className="px-8 py-5 text-xs font-bold text-text-muted uppercase tracking-widest">Hash</th>
                  <th className="px-8 py-5 text-xs font-bold text-text-muted uppercase tracking-widest">Type</th>
                  <th className="px-8 py-5 text-xs font-bold text-text-muted uppercase tracking-widest">Status</th>
                  <th className="px-8 py-5 text-xs font-bold text-text-muted uppercase tracking-widest">Amount</th>
                  <th className="px-8 py-5 text-xs font-bold text-text-muted uppercase tracking-widest text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-default">
                {isLoadingInvoices && Array.from({length: 3}).map((_, i) => (
                  <tr key={`skel-${i}`} className="animate-pulse">
                    <td className="px-6 py-4"><div className="h-4 bg-surface-2 rounded w-24" /></td>
                    <td className="px-6 py-4"><div className="h-4 bg-surface-2 rounded w-16" /></td>
                    <td className="px-6 py-4"><div className="h-4 bg-surface-2 rounded w-20" /></td>
                    <td className="px-6 py-4"><div className="h-4 bg-surface-2 rounded w-14" /></td>
                    <td className="px-6 py-4"><div className="h-4 bg-surface-2 rounded w-12" /></td>
                  </tr>
                ))}
                {!isLoadingInvoices && filteredInvoices.length > 0 ? filteredInvoices.map((invoice) => (
                  <tr key={invoice.id} className="group hover:bg-surface-2 transition-colors">
                    <td className="px-8 py-5">
                      <div className="flex items-center gap-2">
                        <button onClick={() => handleCopyHash(invoice.hash)} className="cursor-pointer">
                          <CipherScramble
                            text={invoice.hash.slice(0, 12) + '...'}
                            className="text-sm font-mono text-text-secondary group-hover:text-white transition-colors"
                          />
                        </button>
                        {isOnChainInvoice(invoice.hash) && (
                          <span className="rounded-full border border-secondary/30 bg-secondary/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-secondary">on-chain</span>
                        )}
                      </div>
                    </td>
                    <td className="px-8 py-5">
                      <span className={`text-xs font-bold uppercase tracking-widest px-2 py-1 rounded-md border ${typeColor(invoice.type)}`}>
                        {invoice.type}
                      </span>
                    </td>
                    <td className="px-8 py-5">
                      <div className="flex items-center gap-2">
                        {statusIcon(invoice.status)}
                        <span className={`text-xs font-bold uppercase tracking-widest ${statusColor(invoice.status)}`}>
                          {invoice.status}
                        </span>
                      </div>
                      {(() => {
                        const op = getOperationalState(invoice);
                        return (
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <span className={`text-[10px] font-bold uppercase tracking-widest ${op.tone}`}>{op.label}</span>
                            <span className="max-w-[160px] truncate text-[10px] text-text-muted">{op.detail}</span>
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-8 py-5">
                      <span className="text-sm font-bold text-white tabular-nums">
                        {invoice.amount || '—'}
                        <span className="text-text-muted text-xs ml-1">{invoice.token ?? 'QIE'}</span>
                      </span>
                      {invoice.type === 'multi-pay' && invoice.totalCollected !== undefined && (
                        <div className="mt-1.5 space-y-1">
                          <div className="w-24 h-1 bg-surface-2 rounded-full overflow-hidden">
                            <div className="h-full bg-primary rounded-full" style={{ width: `${invoice.collectedPercent || 0}%` }} />
                          </div>
                          <p className="text-xs text-text-muted">{invoice.totalCollected}/{invoice.targetAmount} {invoice.token ?? 'QIE'} · {invoice.payerCount} payer{(invoice.payerCount || 0) !== 1 ? 's' : ''}</p>
                        </div>
                      )}
                    </td>
                    <td className="px-8 py-5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setDrawerInvoice(invoice)}>View</Button>
                        {/* Primary action */}
                        {invoice.status === 'open' && invoice.creator?.toLowerCase() !== address?.toLowerCase() && (
                          <Button variant="ghost" size="sm" className="text-secondary" onClick={() => navigate(`/pay/${invoice.hash}`)}>Pay</Button>
                        )}
                        {invoice.status === 'open' && invoice.type === 'recurring' && invoice.creator?.toLowerCase() === address?.toLowerCase() && (
                          <Button variant="ghost" size="sm" className="text-primary" onClick={() => handleUnsupportedAction('Recurring claim')}>Claim</Button>
                        )}
                        {invoice.status === 'open' && invoice.type === 'multi-pay' && invoice.creator?.toLowerCase() === address?.toLowerCase() && (
                          <Button variant="ghost" size="sm" className="text-primary" onClick={() => handleUnsupportedAction('Manual settle')}>Settle</Button>
                        )}
                        {/* More actions dropdown */}
                        {(invoice.creator?.toLowerCase() === address?.toLowerCase() && (invoice.status === 'open' || invoice.status === 'paused' || invoice.status === 'settled')) && (
                          <details className="relative inline-block">
                            <summary className="list-none cursor-pointer p-2 text-text-muted hover:text-primary transition-colors rounded-lg hover:bg-surface-2">
                              <span className="text-sm font-bold tracking-wide">...</span>
                            </summary>
                            <div className="absolute right-0 top-full mt-1 z-50 bg-surface-1 border border-border-default rounded-xl shadow-xl py-1 min-w-[140px]">
                              {invoice.status === 'open' && (
                                <button onClick={() => handlePause(invoice.hash)} className="w-full text-left px-4 py-2 text-xs font-bold text-orange-400 hover:bg-surface-2 transition-colors">Pause</button>
                              )}
                              {invoice.status === 'paused' && (
                                <button onClick={() => handleResume(invoice.hash)} className="w-full text-left px-4 py-2 text-xs font-bold text-primary hover:bg-surface-2 transition-colors">Resume</button>
                              )}
                              {invoice.status === 'settled' && (
                                <button onClick={() => handleRefund(invoice.hash)} className="w-full text-left px-4 py-2 text-xs font-bold text-yellow-400 hover:bg-surface-2 transition-colors">Refund</button>
                              )}
                              {(invoice.status === 'open' || invoice.status === 'paused') && (
                                <button onClick={() => handleCancel(invoice.hash)} className="w-full text-left px-4 py-2 text-xs font-bold text-red-400 hover:bg-surface-2 transition-colors">Cancel</button>
                              )}
                              <button onClick={() => handleShareLink(invoice.hash)} className="w-full text-left px-4 py-2 text-xs font-bold text-text-secondary hover:bg-surface-2 transition-colors">Share Link</button>
                            </div>
                          </details>
                        )}
                        {!(invoice.creator?.toLowerCase() === address?.toLowerCase() && (invoice.status === 'open' || invoice.status === 'paused')) && (
                          <button
                            onClick={() => handleShareLink(invoice.hash)}
                            className="p-2 text-text-muted hover:text-primary transition-colors"
                          >
                            <Share2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )) : !isLoadingInvoices ? (
                  <tr>
                    <td colSpan={5} className="px-8 py-16 text-center">
                      <div className="flex flex-col items-center gap-6 relative">
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                          <div className="w-32 h-32 bg-primary/10 rounded-full blur-3xl" />
                        </div>
                        <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                          className="relative w-16 h-16 bg-surface-2 rounded-2xl flex items-center justify-center border border-border-default">
                          <Lock className="w-8 h-8 text-text-dim" />
                        </motion.div>
                        <div className="space-y-2 text-center">
                          <p className="text-sm font-bold text-white">No invoices in this view</p>
                          <p className="text-xs text-text-muted max-w-xs">
                            Create an invoice or change filters to see backend invoices for this wallet.
                          </p>
                        </div>
                        <Link to="/app/new-cipher">
                          <Button variant="primary" size="sm">Create invoice</Button>
                        </Link>
                      </div>
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <SideDrawer isOpen={!!drawerInvoice} onClose={() => setDrawerInvoice(null)} invoice={drawerInvoice} />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border-default bg-surface-1 p-2">
      <p className="text-[10px] font-bold uppercase tracking-widest text-text-muted">{label}</p>
      <p className="mt-1 truncate text-sm font-bold text-white">{value}</p>
    </div>
  );
}

function toLegacyInvoiceSafe(invoice: import('../../lib/qantaraApi').QantaraInvoice): Invoice {
  return {
    id: invoice.hash,
    hash: invoice.hash,
    type: invoice.invoiceType === 1 ? 'multi-pay' : invoice.invoiceType === 2 ? 'recurring' : invoice.invoiceType === 3 ? 'vesting' : 'standard',
    status: invoice.status === 1 ? 'settled' : invoice.status === 2 || invoice.status === 3 ? 'cancelled' : invoice.status === 4 ? 'paused' : 'open',
    createdAt: new Date(invoice.createdAt * 1000).toISOString(),
    amount: invoice.amount,
    seller: invoice.merchant,
    recipient: invoice.payer ?? '',
    memo: invoice.memo ?? '',
    blockNumber: invoice.createdAt,
    creator: invoice.merchant,
    timestamp: invoice.createdAt,
    deadline: invoice.expiresAt || undefined,
  };
}
