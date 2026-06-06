import { Check, Loader2, Lock, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useAccount, useConnect, usePublicClient, useSendTransaction, useSignTypedData, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from 'wagmi';
import { parseAbi, parseSignature, parseUnits, type Hex } from 'viem';
import { qieMainnet } from '../config/wagmi';
import { getInvoice, InvoiceStatus, nativePaymentValue, tokenSymbol, verifyPayment, type QantaraInvoice } from '../lib/qantaraApi';
import { QANTARA_ADDRESS, QANTARA_SUPPORTS_EIP3009, QUSDC_ADDRESS } from '../lib/dealRoom';
import { erc20ApproveAbi, qantaraAbi } from '../lib/qantaraAbi';
import { buildTransferAuthorizationTypedData, makeTransferAuthorizationNonce, splitTypedSignature } from '../lib/eip3009';
import { describeTxError } from '../lib/walletErrors';

const erc20DecimalsAbi = parseAbi(['function decimals() view returns (uint8)']);
const erc20TransferAbi = parseAbi(['function transfer(address to, uint256 value) returns (bool)']);
const erc20PermitAbi = parseAbi([
  'function name() view returns (string)',
  'function nonces(address owner) view returns (uint256)',
]);

export function Checkout() {
  const { hash } = useParams<{ hash: string }>();
  const [params] = useSearchParams();
  const merchantOrigin = params.get('origin') || '*';
  const { address, chainId, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { sendTransactionAsync } = useSendTransaction();
  const { writeContractAsync } = useWriteContract();
  const { signTypedDataAsync } = useSignTypedData();
  const { switchChainAsync, isPending: isSwitchingChain } = useSwitchChain();
  const publicClient = usePublicClient({ chainId: qieMainnet.id });

  const [status, setStatus] = useState<'loading' | 'idle' | 'paying' | 'verifying' | 'success' | 'error' | 'not-found' | 'expired' | 'already-paid' | 'backend-unavailable'>('loading');
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<Hex | null>(null);
  const [invoice, setInvoice] = useState<QantaraInvoice | null>(null);
  const { isSuccess: txConfirmed } = useWaitForTransactionReceipt({ hash: txHash ?? undefined });
  const wrongNetwork = isConnected && chainId !== undefined && chainId !== qieMainnet.id;

  useEffect(() => {
    if (!hash) return;
    let cancelled = false;
    const load = async () => {
      try {
        const next = await getInvoice(hash);
        if (cancelled) return;
        if (!next) {
          setStatus('not-found');
          return;
        }
        setInvoice(next);
        if (next.status === InvoiceStatus.Paid) {
          setStatus('already-paid');
          if (next.paidTxHash) setTxHash(next.paidTxHash as Hex);
        } else if (next.expiresAt > 0 && Math.floor(Date.now() / 1000) > next.expiresAt) {
          setStatus('expired');
        } else {
          setStatus('idle');
        }
      } catch (err: any) {
        if (cancelled) return;
        setErrMsg(err?.message || 'Backend API is unavailable');
        setStatus('backend-unavailable');
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [hash]);

  useEffect(() => {
    if (!hash || !address || !txHash || !txConfirmed) return;
    const verify = async () => {
      setStatus('verifying');
      try {
        const updated = await verifyPayment(hash, address, txHash);
        setInvoice(updated);
        setStatus('success');
        window.parent?.postMessage({ type: 'qantara:paid', tx: txHash, invoice: hash }, merchantOrigin);
      } catch (err: any) {
        const msg = err?.message || 'Payment verification failed';
        setErrMsg(msg);
        setStatus('error');
        window.parent?.postMessage({ type: 'qantara:error', error: msg }, merchantOrigin);
      }
    };
    void verify();
  }, [address, hash, merchantOrigin, txConfirmed, txHash]);

  const handlePay = useCallback(async () => {
    if (!address || !hash || !invoice) return;
    if (wrongNetwork) {
      try {
        await switchChainAsync({ chainId: qieMainnet.id });
      } catch (e: any) {
        const msg = e?.shortMessage || e?.message || 'Switch to QIE Mainnet before paying';
        setErrMsg(msg);
        setStatus('error');
      }
      return;
    }
    const symbol = tokenSymbol(invoice.token);
    const onChain = Boolean(invoice.metadata?.chain_tx_hash) && Boolean(QANTARA_ADDRESS);
    if (symbol === 'QUSDC' && !QUSDC_ADDRESS) {
      setErrMsg('QUSDC address is not configured.');
      setStatus('error');
      return;
    }
    if (symbol === 'QUSDC' && !publicClient) {
      setErrMsg('QIE RPC client unavailable.');
      setStatus('error');
      return;
    }
    setStatus('paying');
    setErrMsg(null);
    try {
      let submitted: Hex | null = null;
      if (onChain && symbol === 'QIE') {
        submitted = await writeContractAsync({
          account: address,
          chain: qieMainnet,
          address: QANTARA_ADDRESS!,
          abi: qantaraAbi,
          functionName: 'payInvoiceNative',
          args: [invoice.hash as Hex],
          value: nativePaymentValue(invoice),
        } as any);
      } else if (onChain && symbol === 'QUSDC') {
        const decimals = (await (publicClient as any).readContract({
          address: QUSDC_ADDRESS!,
          abi: erc20DecimalsAbi,
          functionName: 'decimals',
        })) as number;
        const value = parseUnits(invoice.amount, decimals);
        try {
          const [name, nonce] = await Promise.all([
            (publicClient as any).readContract({ address: QUSDC_ADDRESS!, abi: erc20PermitAbi, functionName: 'name' }) as Promise<string>,
            (publicClient as any).readContract({ address: QUSDC_ADDRESS!, abi: erc20PermitAbi, functionName: 'nonces', args: [address] }) as Promise<bigint>,
          ]);
          const deadline = BigInt(Math.floor(Date.now() / 1000) + 20 * 60);
          const signature = await signTypedDataAsync({
            account: address,
            domain: { name, version: '1', chainId: qieMainnet.id, verifyingContract: QUSDC_ADDRESS! },
            types: {
              Permit: [
                { name: 'owner', type: 'address' },
                { name: 'spender', type: 'address' },
                { name: 'value', type: 'uint256' },
                { name: 'nonce', type: 'uint256' },
                { name: 'deadline', type: 'uint256' },
              ],
            },
            primaryType: 'Permit',
            message: { owner: address, spender: QANTARA_ADDRESS!, value, nonce, deadline },
          });
          const sig = parseSignature(signature);
          const v = Number(sig.v ?? (27 + Number(sig.yParity ?? 0)));
          submitted = await writeContractAsync({
            account: address,
            chain: qieMainnet,
            address: QANTARA_ADDRESS!,
            abi: qantaraAbi,
            functionName: 'payInvoiceERC20WithPermit',
            args: [invoice.hash as Hex, value, deadline, v, sig.r, sig.s],
          } as any);
        } catch {
          if (QANTARA_SUPPORTS_EIP3009) {
            try {
              const tokenName = (await (publicClient as any).readContract({
                address: QUSDC_ADDRESS!,
                abi: erc20PermitAbi,
                functionName: 'name',
              })) as string;
              const validAfter = 0n;
              const validBefore = BigInt(Math.floor(Date.now() / 1000) + 20 * 60);
              const nonce = makeTransferAuthorizationNonce();
              const signature = await signTypedDataAsync({
                account: address,
                ...buildTransferAuthorizationTypedData({
                  tokenName,
                  from: address,
                  value,
                  validAfter,
                  validBefore,
                  nonce,
                }),
              });
              const sig = splitTypedSignature(signature);
              submitted = await writeContractAsync({
                account: address,
                chain: qieMainnet,
                address: QANTARA_ADDRESS!,
                abi: qantaraAbi,
                functionName: 'payInvoiceERC20WithAuthorization',
                args: [invoice.hash as Hex, value, validAfter, validBefore, nonce, sig.v, sig.r, sig.s],
              } as any);
            } catch (authErr) {
              // EIP-3009 path failed (token may not support it) — fall back to approve+pay below.
              console.warn('[Qantara] EIP-3009 authorization fell back to approve+pay:', describeTxError(authErr).message);
            }
          }

          if (!submitted) {
            const existingAllowance = (await (publicClient as any).readContract({
              address: QUSDC_ADDRESS!,
              abi: erc20ApproveAbi,
              functionName: 'allowance',
              args: [address, QANTARA_ADDRESS!],
            })) as bigint;
            if (existingAllowance < value) {
              const approveTx = await writeContractAsync({
                account: address,
                chain: qieMainnet,
                address: QUSDC_ADDRESS!,
                abi: erc20ApproveAbi,
                functionName: 'approve',
                args: [QANTARA_ADDRESS!, value],
              } as any);
              await publicClient.waitForTransactionReceipt({ hash: approveTx });
            }
            submitted = await writeContractAsync({
              account: address,
              chain: qieMainnet,
              address: QANTARA_ADDRESS!,
              abi: qantaraAbi,
              functionName: 'payInvoiceERC20',
              args: [invoice.hash as Hex, value],
            } as any);
          }
        }
      } else if (symbol === 'QUSDC') {
        const decimals = (await (publicClient as any).readContract({
          address: QUSDC_ADDRESS!,
          abi: erc20DecimalsAbi,
          functionName: 'decimals',
        })) as number;
        submitted = await writeContractAsync({
          account: address,
          chain: qieMainnet,
          address: QUSDC_ADDRESS!,
          abi: erc20TransferAbi,
          functionName: 'transfer',
          args: [invoice.merchant, parseUnits(invoice.amount, decimals)],
        } as any);
      } else {
        submitted = await sendTransactionAsync({ to: invoice.merchant, value: nativePaymentValue(invoice) });
      }
      if (!submitted) throw new Error('Payment transaction was not submitted');
      setTxHash(submitted);
    } catch (e: unknown) {
      const info = describeTxError(e);
      if (info.kind === 'rejected') {
        setStatus('idle');
        setErrMsg(null);
        return;
      }
      setErrMsg(info.message);
      setStatus('error');
      window.parent?.postMessage({ type: 'qantara:error', error: info.message }, merchantOrigin);
    }
  }, [address, hash, invoice, merchantOrigin, publicClient, sendTransactionAsync, signTypedDataAsync, switchChainAsync, writeContractAsync, wrongNetwork]);

  const symbol = invoice ? tokenSymbol(invoice.token) : 'QIE';

  return (
    <div role="main" className="flex min-h-screen items-center justify-center bg-bg-base p-4 text-white">
      <div className="w-full max-w-sm space-y-5 rounded-2xl border border-border-default bg-surface-1 p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-primary" />
            <span className="text-sm font-bold tracking-tight">Qantara Checkout</span>
          </div>
          <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-primary">
            chain {qieMainnet.id}
          </span>
        </div>

        <div className="space-y-1 rounded-xl border border-border-default bg-bg-base p-4 text-center">
          <div className="text-[10px] uppercase tracking-widest text-text-muted">Amount</div>
          <div className="flex items-center justify-center gap-2">
            <span className="text-3xl font-bold tracking-tight">{invoice?.amount ?? '-'}</span>
            <span className="text-sm text-text-secondary">{symbol}</span>
          </div>
          {invoice?.title && <div className="text-xs text-text-muted">{invoice.title}</div>}
        </div>

        <div className="grid grid-cols-2 gap-2 text-[10px]">
          <div className="rounded-lg border border-border-default bg-bg-base px-3 py-2">
            <div className="uppercase tracking-widest text-text-muted">Status</div>
            <div className="mt-1 font-bold text-white">
              {status === 'already-paid' || status === 'success' ? 'Paid' : status === 'expired' ? 'Expired' : status === 'backend-unavailable' ? 'Backend unavailable' : 'Open'}
            </div>
          </div>
          <div className="rounded-lg border border-border-default bg-bg-base px-3 py-2">
            <div className="uppercase tracking-widest text-text-muted">Network</div>
            <div className={wrongNetwork ? 'mt-1 font-bold text-yellow-300' : 'mt-1 font-bold text-white'}>
              {wrongNetwork ? 'Switch required' : `QIE ${qieMainnet.id}`}
            </div>
          </div>
        </div>

        {status === 'loading' ? (
          <div className="flex items-center justify-center gap-2 py-3 text-xs text-text-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading invoice
          </div>
        ) : status === 'not-found' ? (
          <div className="py-3 text-center text-xs text-text-muted">Invoice not found</div>
        ) : status === 'backend-unavailable' ? (
          <StateNotice tone="warn" message={errMsg || 'Backend API is unavailable.'} />
        ) : status === 'expired' ? (
          <StateNotice tone="warn" message="This invoice has expired." />
        ) : status === 'already-paid' ? (
          <ConfirmedState txHash={txHash} />
        ) : !isConnected ? (
          <button onClick={() => connect({ connector: connectors[0] })}
            className="w-full rounded-xl bg-primary py-3 text-sm font-bold text-black transition-opacity hover:opacity-90">
            Connect Wallet
          </button>
        ) : wrongNetwork ? (
          <button onClick={() => void switchChainAsync({ chainId: qieMainnet.id })} disabled={isSwitchingChain}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-bold text-black transition-opacity hover:opacity-90 disabled:opacity-40">
            {isSwitchingChain && <Loader2 className="h-4 w-4 animate-spin" />} Switch to QIE Mainnet
          </button>
        ) : status === 'success' ? (
          <ConfirmedState txHash={txHash} />
        ) : (
          <button onClick={handlePay} disabled={status === 'paying' || status === 'verifying'}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-bold text-black transition-opacity hover:opacity-90 disabled:opacity-40">
            {status === 'paying' || status === 'verifying' ? <><Loader2 className="h-4 w-4 animate-spin" /> {status === 'verifying' ? 'Verifying...' : 'Processing...'}</> : `Pay ${invoice.amount} ${symbol}`}
          </button>
        )}

        {status === 'error' && errMsg && (
          <div className="flex items-start gap-2 rounded-lg bg-red-500/10 p-2 text-[10px] text-red-400">
            <X className="mt-0.5 h-3 w-3 shrink-0" /> <span>{errMsg}</span>
          </div>
        )}

        <div className="border-t border-border-default pt-2 text-center text-[9px] text-text-muted">
          Powered by <span className="font-bold text-primary">Qantara</span> - invoice {hash?.slice(0, 10)}...
        </div>
      </div>
    </div>
  );
}

function ConfirmedState({ txHash }: { txHash: Hex | null }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-center gap-2 rounded-xl bg-primary/10 py-3 text-sm font-bold text-primary">
        <Check className="h-4 w-4" /> Payment confirmed
      </div>
      {txHash && (
        <a href={`${qieMainnet.blockExplorers.default.url}/tx/${txHash}`} target="_blank" rel="noreferrer"
          className="block text-center font-mono text-[10px] text-text-muted hover:text-primary">
          {txHash.slice(0, 14)}...
        </a>
      )}
    </div>
  );
}

function StateNotice({ tone, message }: { tone: 'warn' | 'error'; message: string }) {
  const styles = tone === 'warn' ? 'bg-yellow-500/10 text-yellow-300' : 'bg-red-500/10 text-red-400';
  return (
    <div className={`flex items-start gap-2 rounded-lg p-2 text-[10px] ${styles}`}>
      <X className="mt-0.5 h-3 w-3 shrink-0" /> <span>{message}</span>
    </div>
  );
}
