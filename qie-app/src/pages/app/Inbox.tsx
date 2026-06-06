import { Copy, Download, ExternalLink, Inbox as InboxIcon, MessageSquare, ReceiptText, RefreshCw, Share2, Wallet, Clock, CheckCircle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAccount, usePublicClient, useWriteContract } from 'wagmi';
import { formatEther, formatUnits, parseAbi, zeroAddress } from 'viem';
import { Button } from '../../components/Button';
import { useToastStore } from '../../components/ToastContainer';
import { describeTxError } from '../../lib/walletErrors';
import {
  buildReceiptRecordExport,
  buildReceiptRecordShareText,
  getInvoice,
  getReceipt,
  listInvoices,
  receiptRecordFilename,
  tokenSymbol,
  type QantaraInvoice,
  type ReceiptRecord,
} from '../../lib/qantaraApi';
import { qantaraAbi, qantaraMultiPayAbi } from '../../lib/qantaraAbi';
import { listGuestInvoiceSessions, QANTARA_ADDRESS, QANTARA_MULTIPAY_ADDRESS, QUSDC_ADDRESS } from '../../lib/dealRoom';
import { qieMainnet } from '../../config/wagmi';

interface RefundRow {
  contract: 'Qantara' | 'QantaraMultiPay';
  contractAddress: `0x${string}`;
  token: `0x${string}`;
  tokenLabel: 'QIE' | 'QUSDC';
  amount: bigint;
}

const refundBalancesReader = parseAbi([
  'function refundBalances(address payer, address token) view returns (uint256)',
]);

function formatAmount(value: bigint, label: 'QIE' | 'QUSDC'): string {
  return label === 'QIE' ? formatEther(value) : formatUnits(value, 6);
}

export function Inbox() {
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: qieMainnet.id });
  const { writeContractAsync } = useWriteContract();
  const { addToast } = useToastStore();

  const [items, setItems] = useState<QantaraInvoice[]>([]);
  const [guestItems, setGuestItems] = useState<QantaraInvoice[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [guestLoading, setGuestLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [guestLoadError, setGuestLoadError] = useState<string | null>(null);
  const [receiptLoadError, setReceiptLoadError] = useState<string | null>(null);
  const [refunds, setRefunds] = useState<RefundRow[]>([]);
  const [receiptMap, setReceiptMap] = useState<Map<string, ReceiptRecord>>(new Map());
  const [withdrawing, setWithdrawing] = useState<string | null>(null);
  const explorerUrl = qieMainnet.blockExplorers.default.url;

  const paidCount = items.filter((item) => item.status === 1).length;
  const openCount = items.filter((item) => item.status === 0).length;
  const refundedCount = items.filter((item) => item.status === 3).length;

  const probeTokens = useMemo<{ address: `0x${string}`; label: 'QIE' | 'QUSDC' }[]>(() => {
    const tokens: { address: `0x${string}`; label: 'QIE' | 'QUSDC' }[] = [
      { address: zeroAddress as `0x${string}`, label: 'QIE' },
    ];
    if (QUSDC_ADDRESS) tokens.push({ address: QUSDC_ADDRESS, label: 'QUSDC' });
    return tokens;
  }, []);

  const loadInbox = useCallback(async () => {
    if (!address) {
      setItems([]);
      setReceiptMap(new Map());
      setLoadError(null);
      setReceiptLoadError(null);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setLoadError(null);
    setReceiptLoadError(null);
    try {
      const next = await listInvoices({ payer: address });
      setItems(next.invoices);
      const paidInvoices = next.invoices.filter((invoice) => invoice.status === 1);
      const receiptResults = await Promise.all(
        paidInvoices.map(async (invoice) => {
          try {
            const receipt = await getReceipt(invoice.hash);
            return { hash: invoice.hash.toLowerCase(), receipt, error: null as string | null };
          } catch (err) {
            return {
              hash: invoice.hash.toLowerCase(),
              receipt: null,
              error: err instanceof Error ? err.message : 'Receipt lookup failed',
            };
          }
        }),
      );
      const receiptsByHash = new Map<string, ReceiptRecord>();
      let receiptFailures = 0;
      for (const result of receiptResults) {
        if (result.receipt) receiptsByHash.set(result.hash, result.receipt);
        if (result.error) receiptFailures += 1;
      }
      setReceiptMap(receiptsByHash);
      if (receiptFailures > 0) {
        setReceiptLoadError(`Receipt lookup failed for ${receiptFailures} paid invoice${receiptFailures === 1 ? '' : 's'}. Invoice status still comes from the backend list.`);
      }
    } catch (err) {
      setItems([]);
      setReceiptMap(new Map());
      setLoadError(err instanceof Error ? err.message : 'Could not load payer inbox');
      setReceiptLoadError(null);
    } finally {
      setIsLoading(false);
    }
  }, [address]);

  const loadGuestSessions = useCallback(async () => {
    setGuestLoading(true);
    setGuestLoadError(null);
    try {
      const sessions = listGuestInvoiceSessions();
      if (sessions.length === 0) {
        setGuestItems([]);
        return;
      }
      const invoices = await Promise.all(
        sessions.map(async (session) => {
          try {
            return await getInvoice(session.invoiceHash);
          } catch {
            return null;
          }
        }),
      );
      const unique = new Map<string, QantaraInvoice>();
      for (const invoice of invoices) {
        if (invoice) unique.set(invoice.hash.toLowerCase(), invoice);
      }
      setGuestItems(Array.from(unique.values()));
    } catch (err) {
      setGuestItems([]);
      setGuestLoadError(err instanceof Error ? err.message : 'Could not load guest sessions');
    } finally {
      setGuestLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadInbox();
  }, [loadInbox]);

  useEffect(() => {
    void loadGuestSessions();
  }, [loadGuestSessions]);

  const loadRefunds = useCallback(async () => {
    if (!address || !publicClient) {
      setRefunds([]);
      return;
    }
    const contracts: { name: 'Qantara' | 'QantaraMultiPay'; addr?: `0x${string}` }[] = [
      { name: 'Qantara', addr: QANTARA_ADDRESS },
      { name: 'QantaraMultiPay', addr: QANTARA_MULTIPAY_ADDRESS },
    ];
    const checks: Promise<RefundRow | null>[] = [];
    for (const { name, addr } of contracts) {
      if (!addr) continue;
      for (const t of probeTokens) {
        checks.push(
          (publicClient as any).readContract({
            address: addr,
            abi: refundBalancesReader,
            functionName: 'refundBalances',
            args: [address, t.address],
          })
            .then((amount: bigint) =>
              amount > 0n
                ? { contract: name, contractAddress: addr, token: t.address, tokenLabel: t.label, amount }
                : null,
            )
            .catch(() => null),
        );
      }
    }
    const results = (await Promise.all(checks)).filter((r): r is RefundRow => r !== null);
    setRefunds(results);
  }, [address, publicClient, probeTokens]);

  useEffect(() => {
    void loadRefunds();
  }, [loadRefunds]);

  const handleWithdraw = async (row: RefundRow) => {
    if (!address) return;
    const key = `${row.contractAddress}:${row.token}`;
    setWithdrawing(key);
    try {
      addToast('info', `Withdraw ${formatAmount(row.amount, row.tokenLabel)} ${row.tokenLabel} from ${row.contract}`);
      const abi = row.contract === 'Qantara' ? qantaraAbi : qantaraMultiPayAbi;
      const tx = await writeContractAsync({
        account: address,
        chain: qieMainnet,
        address: row.contractAddress,
        abi,
        functionName: 'withdrawRefund',
        args: [row.token],
      } as any);
      const receipt = await publicClient!.waitForTransactionReceipt({ hash: tx });
      if (receipt.status === 'reverted') throw new Error('The withdrawal transaction reverted on-chain.');
      addToast('success', `Refund withdrawn (tx ${tx.slice(0, 10)}...)`);
      await loadRefunds();
    } catch (err) {
      const info = describeTxError(err);
      addToast(info.kind === 'rejected' ? 'info' : 'error', info.message);
    } finally {
      setWithdrawing(null);
    }
  };

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      addToast('success', `${label} copied`);
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : 'Could not copy');
    }
  };

  const downloadReceipt = (receipt: ReceiptRecord) => {
    const payload = buildReceiptRecordExport(receipt, {
      explorerUrl,
      networkLabel: `QIE Mainnet - chain ${qieMainnet.id}`,
    });
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = receiptRecordFilename(receipt);
    a.click();
    URL.revokeObjectURL(url);
    addToast('success', 'Receipt downloaded');
  };

  const shareReceipt = async (receipt: ReceiptRecord) => {
    const text = buildReceiptRecordShareText(receipt, {
      explorerUrl,
      networkLabel: `QIE Mainnet - chain ${qieMainnet.id}`,
    });
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Qantara receipt', text });
        return;
      }
      await copyToClipboard(text, 'Receipt');
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        addToast('error', err instanceof Error ? err.message : 'Could not share receipt');
      }
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold tracking-tight text-white">Payer Inbox</h1>
          <p className="mt-2 text-text-secondary">Invoices for the connected payer wallet, loaded from the backend API and reconciled with QIE chain state.</p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => void loadInbox()} loading={isLoading} className="gap-2">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-5">
        {[
          { label: 'Addressed', value: items.length, icon: InboxIcon, tone: 'text-white' },
          { label: 'Open', value: openCount, icon: Clock, tone: 'text-secondary' },
          { label: 'Paid', value: paidCount, icon: CheckCircle, tone: 'text-primary' },
          { label: 'Refunded', value: refundedCount, icon: Wallet, tone: 'text-yellow-300' },
          { label: 'Guest', value: guestItems.length, icon: MessageSquare, tone: 'text-yellow-300' },
        ].map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="rounded-2xl border border-border-default bg-surface-1 p-4">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-widest text-text-muted">{stat.label}</span>
                <Icon className={`h-4 w-4 ${stat.tone}`} />
              </div>
              <p className={`mt-3 text-2xl font-bold ${stat.tone}`}>{stat.value}</p>
            </div>
          );
        })}
      </div>

      {(guestLoading || guestItems.length > 0 || guestLoadError) && (
        <section className="rounded-2xl border border-border-default bg-surface-1 p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-white">Guest sessions</h2>
              <p className="text-xs text-text-muted">
                Invoice-scoped sessions created by the backend after payer chat. Wallet connection is optional for continuing the deal room.
              </p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => void loadGuestSessions()} loading={guestLoading} className="gap-2">
              <RefreshCw className="h-3.5 w-3.5" /> Refresh sessions
            </Button>
          </div>
          {guestLoadError ? (
            <div className="rounded-xl border border-yellow-500/25 bg-yellow-500/5 p-3 text-sm text-yellow-200">{guestLoadError}</div>
          ) : guestLoading ? (
            <div className="rounded-xl border border-border-default bg-surface-2 p-4 text-sm text-text-muted">Loading guest sessions...</div>
          ) : guestItems.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border-default bg-surface-2 p-4 text-sm text-text-muted">
              No guest invoice sessions saved in this browser.
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {guestItems.map((invoice) => (
                <div key={invoice.hash} className="rounded-xl border border-border-default bg-surface-2 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-sm text-white">{invoice.hash.slice(0, 12)}...{invoice.hash.slice(-8)}</p>
                      <p className="mt-1 text-xs text-text-muted">{invoice.amount} {tokenSymbol(invoice.token)} · {invoice.status === 1 ? 'paid' : invoice.status === 3 ? 'refunded' : 'open'}</p>
                    </div>
                    <Link to={`/pay/${invoice.hash}`}>
                      <Button size="sm" className="gap-2"><MessageSquare className="h-3.5 w-3.5" /> Continue</Button>
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {refunds.length > 0 && (
        <div className="rounded-2xl border border-yellow-500/30 bg-yellow-500/5 p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-yellow-300" />
            <h2 className="text-lg font-bold text-yellow-300">Pending refunds</h2>
          </div>
          <p className="text-xs text-text-muted">A merchant has credited a refund. Click withdraw to pull the funds into your wallet.</p>
          <div className="space-y-2">
            {refunds.map((r) => {
              const key = `${r.contractAddress}:${r.token}`;
              return (
                <div key={key} className="flex items-center justify-between gap-3 rounded-xl border border-yellow-500/20 bg-surface-1 p-3">
                  <div>
                    <div className="text-sm font-bold text-white">{formatAmount(r.amount, r.tokenLabel)} <span className="text-xs text-text-muted">{r.tokenLabel}</span></div>
                    <div className="text-xs text-text-muted">{r.contract} - <a className="hover:text-primary inline-flex items-center gap-1" href={`${explorerUrl}/address/${r.contractAddress}`} target="_blank" rel="noreferrer">{r.contractAddress.slice(0, 8)}...<ExternalLink className="w-3 h-3" /></a></div>
                  </div>
                  <Button size="sm" loading={withdrawing === key} onClick={() => handleWithdraw(r)}>Withdraw</Button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {receiptLoadError && (
        <div className="rounded-2xl border border-yellow-500/30 bg-yellow-500/5 p-4 text-sm text-yellow-200">
          {receiptLoadError}
        </div>
      )}

      <div className="rounded-2xl border border-border-default bg-surface-1">
        {!address ? (
          <div className="flex flex-col items-center justify-center p-16 text-center">
            <Wallet className="mb-4 h-12 w-12 text-text-dim" />
            <p className="text-lg font-bold text-text-muted">Connect a wallet to open your inbox</p>
            <p className="mt-1 max-w-md text-sm text-text-dim">
              The inbox is scoped to the connected payer address and loads only backend invoices addressed to that wallet.
            </p>
          </div>
        ) : isLoading ? (
          <div className="p-8 text-sm text-text-muted">Loading inbox...</div>
        ) : loadError ? (
          <div className="flex flex-col items-center justify-center p-16 text-center">
            <AlertPanel message={loadError} onRetry={() => void loadInbox()} />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-16 text-center">
            <InboxIcon className="mb-4 h-12 w-12 text-text-dim" />
            <p className="text-lg font-bold text-text-muted">No invoices for this wallet</p>
            <p className="mt-1 max-w-md text-sm text-text-dim">
              Qantara links addressed to this wallet appear here after they are stored by the backend. Paid state appears only after QIE RPC verification.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border-default">
            {items.map((invoice) => {
              const chainTxHash = typeof (invoice.metadata as Record<string, unknown> | undefined)?.chain_tx_hash === 'string'
                ? (invoice.metadata as Record<string, string>).chain_tx_hash
                : invoice.paidTxHash;
              const isOnChain = Boolean(chainTxHash);
              const receipt = receiptMap.get(invoice.hash.toLowerCase());
              return (
                <div key={invoice.hash} className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-mono text-sm text-white">{invoice.hash.slice(0, 12)}...{invoice.hash.slice(-8)}</p>
                      <span className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-primary">
                        {invoice.status === 1 ? 'paid' : invoice.status === 3 ? 'refunded' : 'open'}
                      </span>
                      {isOnChain && (
                        <span className="rounded-full border border-secondary/30 bg-secondary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-secondary">
                          chain verified
                        </span>
                      )}
                      <span className="rounded-full border border-border-default bg-surface-2 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-text-muted">
                        backend record
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-text-secondary">
                      {invoice.amount} {tokenSymbol(invoice.token)}
                    </p>
                    {receipt ? (
                      <div className="mt-1 space-y-1 text-xs">
                        <p className="text-primary">Receipt {receipt.receiptHash.slice(0, 10)}...{receipt.receiptHash.slice(-6)} issued {new Date(receipt.issuedAt * 1000).toLocaleString()}</p>
                        <p className="font-mono text-text-muted">Tx {receipt.txHash.slice(0, 12)}...{receipt.txHash.slice(-8)}</p>
                      </div>
                    ) : invoice.status === 1 ? (
                      <p className="mt-1 text-xs text-yellow-300">Paid in backend state; receipt API record is not issued yet.</p>
                    ) : null}
                    {chainTxHash && !receipt && (
                      <a className="mt-1 inline-flex items-center gap-1 text-xs text-text-muted hover:text-primary" href={`${explorerUrl}/tx/${chainTxHash}`} target="_blank" rel="noreferrer">
                        View payment transaction <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link to={`/pay/${invoice.hash}`}>
                      <Button size="sm" className="gap-2"><MessageSquare className="h-3.5 w-3.5" /> Ask / Pay</Button>
                    </Link>
                    {receipt ? (
                      <>
                        <Button size="sm" variant="secondary" className="gap-2" onClick={() => downloadReceipt(receipt)}>
                          <Download className="h-3.5 w-3.5" /> Download
                        </Button>
                        <Button size="sm" variant="secondary" className="gap-2" onClick={() => shareReceipt(receipt)}>
                          <Share2 className="h-3.5 w-3.5" /> Share
                        </Button>
                        <Button size="sm" variant="ghost" className="gap-2" onClick={() => copyToClipboard(receipt.receiptHash, 'Receipt hash')}>
                          <Copy className="h-3.5 w-3.5" /> Copy hash
                        </Button>
                        <a href={`${explorerUrl}/tx/${receipt.txHash}`} target="_blank" rel="noreferrer">
                          <Button size="sm" variant="ghost" className="gap-2">
                            <ExternalLink className="h-3.5 w-3.5" /> Tx
                          </Button>
                        </a>
                      </>
                    ) : (
                      <Link to="/app/inbox?tab=receipts">
                        <Button size="sm" variant="secondary" className="gap-2" disabled>
                          <ReceiptText className="h-3.5 w-3.5" /> No receipt yet
                        </Button>
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function AlertPanel({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="max-w-md rounded-2xl border border-red-500/25 bg-red-500/5 p-5">
      <p className="text-sm font-bold text-red-200">Inbox unavailable</p>
      <p className="mt-2 text-sm text-text-muted">{message}</p>
      <Button size="sm" variant="secondary" className="mt-4 gap-2" onClick={onRetry}>
        <RefreshCw className="h-3.5 w-3.5" /> Retry
      </Button>
    </div>
  );
}
