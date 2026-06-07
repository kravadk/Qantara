import { motion } from 'framer-motion';
import { AlertTriangle, BadgeCheck, CheckCircle, Clock, Copy, ExternalLink, Fuel, Loader2, Lock, MessageSquare, QrCode, Route, Share2, XCircle, Zap } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAccount, useBalance, usePublicClient, useSendTransaction, useSignTypedData, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from 'wagmi';
import { parseAbi, parseSignature, parseUnits, type Hex } from 'viem';
import { Button } from '../components/Button';
import { DealRoomPanel } from '../components/DealRoomPanel';
import { useToastStore } from '../components/ToastContainer';
import { WalletModal } from '../components/WalletModal';
import { PayTrustRail, WalletHealthCard, useBackendHealth } from '../components/ProductOps';
import { qieMainnet } from '../config/wagmi';
import { QUSDC_ADDRESS, QANTARA_ADDRESS, QANTARA_SUPPORTS_EIP3009, QANTARA_BACKEND_URL } from '../lib/dealRoom';
import { getInvoice, getPaymentRoutePlan, InvoiceStatus, nativePaymentValue, tokenSymbol, verifyPayment, type PaymentRouteAction, type PaymentRouteCandidate, type PaymentRoutePlan, type QantaraInvoice } from '../lib/api/invoicesApi';
import { getPublicMerchantProfile, type MerchantTrustProfile } from '../lib/api/merchantApi';
import { useSeo } from '../lib/useSeo';
import { getQusdcCapabilities, type QusdcCapabilityProbe } from '../lib/api/railsApi';
import { getQieNetworkCatalog, type QieNetworkCatalog } from '../lib/api/qieApi';
import { qantaraAbi, erc20ApproveAbi } from '../lib/qantaraAbi';
import { buildTransferAuthorizationTypedData, makeTransferAuthorizationNonce, splitTypedSignature } from '../lib/eip3009';
import { useDealRoom } from '../hooks/useDealRoom';
import { describeTxError } from '../lib/walletErrors';
import type { BackendHealth } from '../lib/qantaraApi';

const erc20DecimalsAbi = parseAbi(['function decimals() view returns (uint8)']);
const erc20TransferAbi = parseAbi(['function transfer(address to, uint256 value) returns (bool)']);
const vaultMintAbi = parseAbi([
  'function mint(uint256 amount) external returns (uint256)',
  'function deposit(uint256 amount) external returns (uint256)',
]);
const erc20PermitAbi = parseAbi([
  'function name() view returns (string)',
  'function nonces(address owner) view returns (uint256)',
]);

type PayStatus = 'loading' | 'ready' | 'paying' | 'verifying' | 'success' | 'error' | 'not-found' | 'expired' | 'already-paid' | 'backend-unavailable';
type PayAcquisitionRoute = PaymentRoutePlan['acquisitionRoutes'][number];

const fullDateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
});

export function Pay() {
  const { hash } = useParams<{ hash: string }>();
  // Payer-specific checkout: give it a per-route title but keep it out of search
  // indexes (an invoice link is private to the merchant and payer).
  useSeo({
    title: 'Pay invoice',
    description: 'Review and pay this Qantara invoice on QIE Mainnet. Settlement is verified through QIE RPC before any receipt is issued.',
    noindex: true,
  });
  const { isConnected, address, chainId } = useAccount();
  const { addToast } = useToastStore();
  const { sendTransactionAsync } = useSendTransaction();
  const { writeContractAsync } = useWriteContract();
  const { signTypedDataAsync } = useSignTypedData();
  const { switchChainAsync, isPending: isSwitchingChain } = useSwitchChain();
  const publicClient = usePublicClient({ chainId: qieMainnet.id });
  const { health: backendHealth, error: backendHealthError, isLoading: backendHealthLoading, refresh: refreshBackendHealth } = useBackendHealth();

  const [payStatus, setPayStatus] = useState<PayStatus>('loading');
  const [invoice, setInvoice] = useState<QantaraInvoice | null>(null);
  const [txHash, setTxHash] = useState<Hex | null>(null);
  const [payError, setPayError] = useState<string | null>(null);
  const [isWalletModalOpen, setIsWalletModalOpen] = useState(false);
  const [copiedTarget, setCopiedTarget] = useState<'link' | 'hash' | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [routePlan, setRoutePlan] = useState<PaymentRoutePlan | null>(null);
  const [routePlanError, setRoutePlanError] = useState<string | null>(null);
  const [routePlanLoading, setRoutePlanLoading] = useState(false);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [qusdcCapabilities, setQusdcCapabilities] = useState<QusdcCapabilityProbe | null>(null);
  const [qusdcCapabilitiesError, setQusdcCapabilitiesError] = useState<string | null>(null);
  const [networkCatalog, setNetworkCatalog] = useState<QieNetworkCatalog | null>(null);
  const [networkCatalogError, setNetworkCatalogError] = useState<string | null>(null);
  const [mintingRouteId, setMintingRouteId] = useState<string | null>(null);
  const dealRoomRef = useRef<HTMLDivElement | null>(null);
  const { events: liveEvents, streamStatus, lastStreamEventAt } = useDealRoom(hash, 'payer');
  // Native QIE balance of the connected payer — drives the "No QIE for gas" UX.
  const { data: nativeBalance } = useBalance({ address, chainId: qieMainnet.id });
  const manualRouteRef = useRef(false);
  const gaslessNudgeRef = useRef(false);

  const explorerUrl = qieMainnet.blockExplorers.default.url;
  const { isSuccess: txConfirmed, data: txReceipt, isError: txReceiptFailed, error: txReceiptError } = useWaitForTransactionReceipt({ hash: txHash ?? undefined });
  const wrongNetwork = isConnected && chainId !== undefined && chainId !== qieMainnet.id;

  // On-chain revert: the receipt resolves with status 'reverted' (it does not throw).
  useEffect(() => {
    if (!txHash || !txReceipt || txReceipt.status !== 'reverted') return;
    if (hash) { try { localStorage.removeItem(`qantara:pending-tx:${hash.toLowerCase()}`); } catch { /* ignore */ } }
    setPayError('The payment transaction reverted on-chain. No funds were transferred — check the amount and try again.');
    setPayStatus('error');
  }, [hash, txHash, txReceipt]);

  // RPC could not confirm the receipt (timeout / node down) — surface, never hang silently.
  useEffect(() => {
    if (!txHash || !txReceiptFailed) return;
    setPayError(describeTxError(txReceiptError).message);
    setPayStatus('error');
  }, [txHash, txReceiptFailed, txReceiptError]);

  // Account switched mid-flow: a tx signed by the old account is invalid — reset and warn.
  const submittedByRef = useRef<string | null>(null);
  useEffect(() => {
    if (!txHash || !submittedByRef.current || !address) return;
    if (address.toLowerCase() !== submittedByRef.current.toLowerCase()) {
      setTxHash(null);
      submittedByRef.current = null;
      if (hash) { try { localStorage.removeItem(`qantara:pending-tx:${hash.toLowerCase()}`); } catch { /* ignore */ } }
      if (invoice && invoice.status !== InvoiceStatus.Paid) setPayStatus('ready');
      addToast('info', 'Wallet account changed — restart the payment with the new account.');
    }
  }, [address, hash, txHash, invoice, addToast]);

  useEffect(() => {
    if (!hash) return;
    let cancelled = false;
    const loadInvoice = async () => {
      try {
        const next = await getInvoice(hash);
        if (cancelled) return;
        if (!next) {
          setPayStatus('not-found');
          return;
        }
        setInvoice(next);
        if (next.status === InvoiceStatus.Paid) {
          setPayStatus('already-paid');
          if (next.paidTxHash) setTxHash(next.paidTxHash as Hex);
        } else if (next.expiresAt > 0 && Math.floor(Date.now() / 1000) > next.expiresAt) {
          setPayStatus('expired');
        } else {
          setPayStatus('ready');
          // Resume after a mid-flow refresh: a submitted-but-unverified tx hash is restored so verification continues.
          try {
            const pending = localStorage.getItem(`qantara:pending-tx:${hash.toLowerCase()}`);
            if (pending && /^0x[0-9a-fA-F]{64}$/.test(pending)) setTxHash(pending as Hex);
          } catch { /* localStorage unavailable */ }
        }
      } catch (err: unknown) {
        if (cancelled) return;
        setPayError(describeTxError(err).message);
        setPayStatus('backend-unavailable');
      }
    };
    void loadInvoice();
    return () => {
      cancelled = true;
    };
  }, [hash]);

  useEffect(() => {
    let active = true;
    getQieNetworkCatalog()
      .then((catalog) => {
        if (!active) return;
        setNetworkCatalog(catalog);
        setNetworkCatalogError(null);
      })
      .catch((err) => {
        if (!active) return;
        setNetworkCatalog(null);
        setNetworkCatalogError(err instanceof Error ? err.message : 'QIE network catalog unavailable');
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!hash || !invoice) return;
    let cancelled = false;
    const loadRoutePlan = async () => {
      setRoutePlanLoading(true);
      setRoutePlanError(null);
      try {
        const plan = await getPaymentRoutePlan(hash);
        if (cancelled) return;
        setRoutePlan(plan);
        const recommended = plan.recommendedRouteId
          ?? plan.routes.find((route) => route.state === 'ready')?.id
          ?? null;
        setSelectedRouteId((current) => (
          current && plan.routes.some((route) => route.id === current) ? current : recommended
        ));
      } catch (err) {
        if (cancelled) return;
        setRoutePlan(null);
        setSelectedRouteId(null);
        setRoutePlanError(err instanceof Error ? err.message : 'Payment route planner is unavailable');
      } finally {
        if (!cancelled) setRoutePlanLoading(false);
      }
    };
    void loadRoutePlan();
    return () => {
      cancelled = true;
    };
  }, [hash, invoice]);

  // "No QIE for gas": when the connected payer has zero native QIE and a gasless
  // route is ready, auto-prefer it (unless the payer manually picked a route).
  useEffect(() => {
    if (!routePlan || !isConnected || manualRouteRef.current) return;
    if (!nativeBalance || nativeBalance.value > 0n) return; // gas present or unknown — leave selection alone
    const gasless = routePlan.routes.find((r) => r.requiresNativeGas === false && r.state === 'ready');
    if (!gasless) return;
    const current = routePlan.routes.find((r) => r.id === selectedRouteId) ?? null;
    if (current?.requiresNativeGas === false) return; // already on a gasless route
    setSelectedRouteId(gasless.id);
    if (!gaslessNudgeRef.current) {
      gaslessNudgeRef.current = true;
      addToast('info', 'No QIE for gas — switched to the gasless QUSDC route.');
    }
  }, [routePlan, isConnected, nativeBalance, selectedRouteId, addToast]);

  useEffect(() => {
    if (!invoice || tokenSymbol(invoice.token) !== 'QUSDC') {
      setQusdcCapabilities(null);
      setQusdcCapabilitiesError(null);
      return;
    }
    let active = true;
    getQusdcCapabilities()
      .then((probe) => {
        if (!active) return;
        setQusdcCapabilities(probe);
        setQusdcCapabilitiesError(null);
      })
      .catch((err) => {
        if (!active) return;
        setQusdcCapabilities(null);
        setQusdcCapabilitiesError(err instanceof Error ? err.message : 'QUSDC capability probe unavailable');
      });
    return () => {
      active = false;
    };
  }, [invoice]);

  useEffect(() => {
    if (!hash || !address || !txHash || !txConfirmed || invoice?.status === InvoiceStatus.Paid) return;
    const verify = async () => {
      setPayStatus('verifying');
      try {
        const updated = await verifyPayment(hash, address, txHash);
        setInvoice(updated);
        setPayStatus('success');
        try { localStorage.removeItem(`qantara:pending-tx:${hash.toLowerCase()}`); } catch { /* localStorage unavailable */ }
        addToast('success', 'Payment verified on QIE RPC');
      } catch (err: unknown) {
        setPayError(describeTxError(err).message);
        setPayStatus('error');
      }
    };
    void verify();
  }, [addToast, address, hash, invoice?.status, txConfirmed, txHash]);

  useEffect(() => {
    if (!hash || liveEvents.length === 0) return;
    const latest = liveEvents[liveEvents.length - 1];
    if (latest.type === 'invoice.paid' || latest.type === 'receipt.created') {
      void getInvoice(hash).then((next) => {
        if (!next) return;
        setInvoice(next);
        setPayStatus((current) => next.status === InvoiceStatus.Paid ? 'success' : current);
      });
    }
  }, [hash, liveEvents]);

  const handlePay = async () => {
    if (!invoice || !hash) return;
    const selectedRoute = routePlan?.routes.find((route) => route.id === selectedRouteId) ?? null;
    if (routePlanLoading) {
      setPayError('Payment routes are still loading. Wait for the backend route planner.');
      setPayStatus('error');
      return;
    }
    if (routePlanError || !routePlan) {
      setPayError(routePlanError || 'Payment route planner is unavailable. Checkout cannot pick a verified payment route.');
      setPayStatus('error');
      return;
    }
    if (!routePlan.payable || routePlan.state !== 'ready') {
      setPayError(routePlan.reason || 'This invoice is not payable through the configured Qantara rails.');
      setPayStatus('error');
      return;
    }
    if (!selectedRoute || selectedRoute.state !== 'ready') {
      setPayError(selectedRoute?.reason || 'Choose an available payment route before paying.');
      setPayStatus('error');
      return;
    }
    const externalCheckout = selectedRoute.actions.find((action) => action.type === 'external_checkout' && action.url);
    if (externalCheckout?.url) {
      const url = new URL(externalCheckout.url);
      url.searchParams.set('returnUrl', `${window.location.origin}/pay/${hash}`);
      if (address) url.searchParams.set('payer', address);
      const opened = window.open(url.toString(), '_blank', 'noopener,noreferrer');
      if (!opened) window.location.assign(url.toString());
      addToast('info', 'Gasless checkout opened. Qantara will show paid only after RPC verification.');
      setPayStatus('ready');
      return;
    }
    if (!isConnected || !address) {
      setIsWalletModalOpen(true);
      return;
    }
    if (wrongNetwork) {
      setPayError('Switch your wallet to QIE Mainnet before paying this invoice.');
      setPayStatus('error');
      try {
        await switchChainAsync({ chainId: qieMainnet.id });
        setPayError(null);
        setPayStatus('ready');
      } catch (err: any) {
        setPayError(err?.shortMessage || err?.message || 'Could not switch to QIE Mainnet');
      }
      return;
    }
    const symbol = tokenSymbol(invoice.token);
    if (symbol === 'QUSDC' && !QUSDC_ADDRESS) {
      setPayError('QUSDC token is not configured. Set VITE_QUSDC_ADDRESS in the frontend env.');
      setPayStatus('error');
      return;
    }
    if (symbol === 'QUSDC' && !publicClient) {
      setPayError('Network client unavailable. Reconnect your wallet and try again.');
      setPayStatus('error');
      return;
    }

    setPayStatus('paying');
    setPayError(null);
    try {
      let submitted: Hex | null = null;
      const execution: {
        tokenValue?: bigint;
        permit?: { value: bigint; deadline: bigint; v: number; r: Hex; s: Hex };
        authorization?: { value: bigint; validAfter: bigint; validBefore: bigint; nonce: Hex; v: number; r: Hex; s: Hex };
      } = {};
      const qantaraTarget = selectedRoute.settlementContract ?? QANTARA_ADDRESS;
      const qusdcTarget = selectedRoute.token.address ?? QUSDC_ADDRESS;
      const tokenValue = async () => {
        if (execution.tokenValue !== undefined) return execution.tokenValue;
        if (!qusdcTarget || !publicClient) throw new Error('QUSDC route requires a configured token and network client');
        const decimals = (await (publicClient as any).readContract({
          address: qusdcTarget,
          abi: erc20DecimalsAbi,
          functionName: 'decimals',
        })) as number;
        execution.tokenValue = parseUnits(invoice.amount, decimals);
        return execution.tokenValue;
      };

      for (const action of selectedRoute.actions) {
        if (action.type === 'wallet_sendTransaction') {
          addToast('info', action.label || 'Confirm QIE transfer in your wallet');
          submitted = await sendTransactionAsync({
            to: (action.target ?? invoice.merchant) as Hex,
            value: nativePaymentValue(invoice),
          });
        } else if (action.type === 'erc20_transfer') {
          if (!qusdcTarget) throw new Error('QUSDC transfer route is missing token target');
          addToast('info', action.label || 'Confirm token transfer in your wallet');
          submitted = await writeContractAsync({
            account: address,
            chain: qieMainnet,
            address: qusdcTarget,
            abi: erc20TransferAbi,
            functionName: 'transfer',
            args: [invoice.merchant, await tokenValue()],
          } as any);
        } else if (action.type === 'erc20_approve') {
          if (!qusdcTarget || !qantaraTarget || !publicClient) throw new Error('Approve route is missing token or settlement contract');
          const value = await tokenValue();
          const existingAllowance = (await (publicClient as any).readContract({
            address: qusdcTarget,
            abi: erc20ApproveAbi,
            functionName: 'allowance',
            args: [address, qantaraTarget],
          })) as bigint;
          if (existingAllowance < value) {
            addToast('info', action.label || 'Approve token spend');
            const approveTx = await writeContractAsync({
              account: address,
              chain: qieMainnet,
              address: qusdcTarget,
              abi: erc20ApproveAbi,
              functionName: 'approve',
              args: [qantaraTarget, value],
            } as any);
            await publicClient.waitForTransactionReceipt({ hash: approveTx });
          }
        } else if (action.type === 'typed_data_signature' && action.method === 'permit') {
          if (!qusdcTarget || !qantaraTarget || !publicClient) throw new Error('Permit route is missing token or settlement contract');
          const value = await tokenValue();
          const [name, nonce] = await Promise.all([
            (publicClient as any).readContract({ address: qusdcTarget, abi: erc20PermitAbi, functionName: 'name' }) as Promise<string>,
            (publicClient as any).readContract({ address: qusdcTarget, abi: erc20PermitAbi, functionName: 'nonces', args: [address] }) as Promise<bigint>,
          ]);
          const deadline = BigInt(Math.floor(Date.now() / 1000) + 20 * 60);
          addToast('info', action.label || 'Sign token permit');
          const signature = await signTypedDataAsync({
            account: address,
            domain: { name, version: '1', chainId: qieMainnet.id, verifyingContract: qusdcTarget },
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
            message: { owner: address, spender: qantaraTarget, value, nonce, deadline },
          });
          const sig = parseSignature(signature);
          execution.permit = { value, deadline, v: Number(sig.v ?? (27 + Number(sig.yParity ?? 0))), r: sig.r, s: sig.s };
        } else if (action.type === 'typed_data_signature' && action.method === 'transferWithAuthorization') {
          if (!qusdcTarget || !QANTARA_SUPPORTS_EIP3009 || !publicClient) throw new Error('EIP-3009 route is unavailable for the configured QUSDC token');
          const value = await tokenValue();
          const tokenName = (await (publicClient as any).readContract({
            address: qusdcTarget,
            abi: erc20PermitAbi,
            functionName: 'name',
          })) as string;
          const validAfter = 0n;
          const validBefore = BigInt(Math.floor(Date.now() / 1000) + 20 * 60);
          const nonce = makeTransferAuthorizationNonce();
          addToast('info', action.label || 'Sign transfer authorization');
          const signature = await signTypedDataAsync({
            account: address,
            ...buildTransferAuthorizationTypedData({ tokenName, from: address, value, validAfter, validBefore, nonce }),
          });
          const sig = splitTypedSignature(signature);
          execution.authorization = { value, validAfter, validBefore, nonce, v: sig.v, r: sig.r, s: sig.s };
        } else if (action.type === 'contract_write') {
          if (!qantaraTarget) throw new Error('Contract route is missing settlement contract');
          addToast('info', action.label || 'Confirm contract payment');
          if (action.method === 'payInvoiceNative') {
            submitted = await writeContractAsync({
              account: address,
              chain: qieMainnet,
              address: qantaraTarget,
              abi: qantaraAbi,
              functionName: 'payInvoiceNative',
              args: [invoice.hash as Hex],
              value: nativePaymentValue(invoice),
            } as any);
          } else if (action.method === 'payInvoiceERC20') {
            submitted = await writeContractAsync({
              account: address,
              chain: qieMainnet,
              address: qantaraTarget,
              abi: qantaraAbi,
              functionName: 'payInvoiceERC20',
              args: [invoice.hash as Hex, await tokenValue()],
            } as any);
          } else if (action.method === 'payInvoiceERC20WithPermit') {
            if (!execution.permit) throw new Error('Permit signature action must run before permit payment submit');
            submitted = await writeContractAsync({
              account: address,
              chain: qieMainnet,
              address: qantaraTarget,
              abi: qantaraAbi,
              functionName: 'payInvoiceERC20WithPermit',
              args: [invoice.hash as Hex, execution.permit.value, execution.permit.deadline, execution.permit.v, execution.permit.r, execution.permit.s],
            } as any);
          } else if (action.method === 'payInvoiceERC20WithAuthorization') {
            if (!execution.authorization) throw new Error('Transfer authorization action must run before authorization payment submit');
            submitted = await writeContractAsync({
              account: address,
              chain: qieMainnet,
              address: qantaraTarget,
              abi: qantaraAbi,
              functionName: 'payInvoiceERC20WithAuthorization',
              args: [
                invoice.hash as Hex,
                execution.authorization.value,
                execution.authorization.validAfter,
                execution.authorization.validBefore,
                execution.authorization.nonce,
                execution.authorization.v,
                execution.authorization.r,
                execution.authorization.s,
              ],
            } as any);
          } else {
            throw new Error(`Unsupported backend contract action method: ${action.method ?? 'unknown'}`);
          }
        } else if (action.type === 'external_checkout') {
          throw new Error('External checkout route must be opened before wallet transaction execution');
        } else {
          throw new Error(`Unsupported backend payment action: ${(action as PaymentRouteAction).type}`);
        }
      }

      if (!submitted) throw new Error('Payment transaction was not submitted');
      submittedByRef.current = address ?? null;
      setTxHash(submitted);
      try { localStorage.setItem(`qantara:pending-tx:${hash.toLowerCase()}`, submitted); } catch { /* localStorage unavailable */ }
      addToast('info', 'Transaction submitted. Waiting for RPC confirmation...');
    } catch (err: unknown) {
      const info = describeTxError(err);
      if (info.kind === 'rejected') {
        // Not an error state — let the payer retry from a clean ready screen.
        setPayStatus('ready');
        addToast('info', info.message);
        return;
      }
      setPayError(info.message);
      setPayStatus('error');
      addToast('error', info.message);
    }
  };

  const copyValue = async (target: 'link' | 'hash', value: string, toast: string) => {
    await navigator.clipboard.writeText(value);
    setCopiedTarget(target);
    setTimeout(() => setCopiedTarget(null), 1500);
    addToast('success', toast);
  };

  const handleCopyLink = () => {
    if (!hash) return;
    void copyValue('link', `${window.location.origin}/pay/${hash}`, 'Payment link copied');
  };

  const handleCopyInvoiceHash = () => {
    if (!invoice) return;
    void copyValue('hash', invoice.hash, 'Invoice hash copied');
  };

  const handleShareLink = async () => {
    if (!hash) return;
    const url = `${window.location.origin}/pay/${hash}`;
    if (navigator.share) {
      try {
        await navigator.share({
          title: invoice?.title || 'Qantara checkout',
          text: invoice ? `Pay ${invoice.amount} ${tokenSymbol(invoice.token)} on QIE Mainnet` : 'Qantara checkout',
          url,
        });
        return;
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
      }
    }
    await copyValue('link', url, 'Payment link copied');
  };

  const scrollToDealRoom = () => {
    dealRoomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const scrollToAcquire = () => {
    document.getElementById('acquire-qie')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleMintQusdc = async (route: PayAcquisitionRoute) => {
    if (!invoice) return;
    if (!isConnected || !address) {
      setIsWalletModalOpen(true);
      return;
    }
    if (wrongNetwork) {
      try {
        await switchChainAsync({ chainId: qieMainnet.id });
      } catch (err: any) {
        addToast('error', err?.shortMessage || err?.message || 'Could not switch to QIE Mainnet');
        return;
      }
    }
    if (!publicClient) {
      addToast('error', 'QIE RPC client unavailable. Reconnect wallet and retry.');
      return;
    }
    const vaultAddress = route.metadata?.vaultAddress as Hex | null | undefined;
    const wusdcAddress = route.metadata?.wusdcAddress as Hex | null | undefined;
    const mintMethod = route.metadata?.mintMethod === 'deposit' ? 'deposit' : 'mint';
    if (!vaultAddress || !wusdcAddress) {
      addToast('error', 'QUSDC vault route is not configured by the backend.');
      return;
    }

    setMintingRouteId(route.id);
    try {
      const decimals = (await (publicClient as any).readContract({
        address: wusdcAddress,
        abi: erc20DecimalsAbi,
        functionName: 'decimals',
      })) as number;
      const value = parseUnits(invoice.amount, decimals);
      const allowance = (await (publicClient as any).readContract({
        address: wusdcAddress,
        abi: erc20ApproveAbi,
        functionName: 'allowance',
        args: [address, vaultAddress],
      })) as bigint;

      if (allowance < value) {
        addToast('info', 'Approve exact WUSDC amount for the QUSDC vault');
        const approveTx = await writeContractAsync({
          account: address,
          chain: qieMainnet,
          address: wusdcAddress,
          abi: erc20ApproveAbi,
          functionName: 'approve',
          args: [vaultAddress, value],
        } as any);
        await publicClient.waitForTransactionReceipt({ hash: approveTx });
      }

      addToast('info', `Minting ${invoice.amount} QUSDC through the configured vault`);
      const mintTx = await writeContractAsync({
        account: address,
        chain: qieMainnet,
        address: vaultAddress,
        abi: vaultMintAbi,
        functionName: mintMethod,
        args: [value],
      } as any);
      await publicClient.waitForTransactionReceipt({ hash: mintTx });
      addToast('success', 'QUSDC mint confirmed on QIE RPC. You can now pay this invoice.');
    } catch (err) {
      addToast('error', describeTxError(err).message);
    } finally {
      setMintingRouteId(null);
    }
  };

  const payUrl = hash ? `${window.location.origin}/pay/${hash}` : window.location.href;

  const routePlanBlocksPayment = Boolean(routePlan && (!routePlan.payable || routePlan.state !== 'ready'));
  const canPay = payStatus !== 'expired' && payStatus !== 'already-paid' && payStatus !== 'success' && !routePlanBlocksPayment;

  const getCheckoutBadge = () => {
    if (payStatus === 'already-paid' || payStatus === 'success') return 'Paid';
    if (payStatus === 'expired') return 'Expired';
    if (wrongNetwork) return 'Wrong network';
    if (payStatus === 'paying') return 'Wallet';
    if (payStatus === 'verifying') return 'Verifying';
    return 'Open';
  };

  const getCheckoutBadgeClass = () => {
    if (payStatus === 'already-paid' || payStatus === 'success') return 'border border-primary/30 bg-primary/15 text-primary';
    if (payStatus === 'expired' || wrongNetwork) return 'border border-yellow-500/30 bg-yellow-500/15 text-yellow-300';
    if (payStatus === 'paying' || payStatus === 'verifying') return 'border border-secondary/30 bg-secondary/15 text-secondary';
    return 'border border-secondary/30 bg-secondary/15 text-secondary';
  };

  if (payStatus === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg-base p-6 text-white">
        <div className="flex items-center gap-3 text-text-muted">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading invoice...
        </div>
      </div>
    );
  }

  if (payStatus === 'not-found') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg-base p-6 text-white">
        <div className="w-full max-w-md space-y-3 rounded-2xl border border-border-default bg-surface-1 p-8 text-center">
          <AlertTriangle className="mx-auto h-10 w-10 text-yellow-400" />
          <h2 className="text-xl font-bold">Invoice not found</h2>
          <p className="text-sm text-text-muted">This Qantara invoice was not found in the configured backend API. If it was just created, it may take a moment to index.</p>
          <div className="flex items-center justify-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>Check again</Button>
            <Link to="/"><Button variant="ghost" size="sm">Back to home</Button></Link>
          </div>
        </div>
      </div>
    );
  }

  if (payStatus === 'backend-unavailable') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg-base p-6 text-white">
        <div className="w-full max-w-md space-y-3 rounded-2xl border border-border-default bg-surface-1 p-8 text-center">
          <AlertTriangle className="mx-auto h-10 w-10 text-yellow-400" />
          <h2 className="text-xl font-bold">Backend unavailable</h2>
          <p className="text-sm text-text-muted">{payError || 'Invoice data could not be loaded from the backend API.'}</p>
          <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>Retry</Button>
        </div>
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg-base p-6 text-white">
        <div className="w-full max-w-md space-y-3 rounded-2xl border border-border-default bg-surface-1 p-8 text-center">
          <AlertTriangle className="mx-auto h-10 w-10 text-yellow-400" />
          <h2 className="text-xl font-bold">Invoice not loaded</h2>
          <p className="text-sm text-text-muted">The backend did not return an invoice record for this Qantara invoice yet.</p>
          <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>Retry</Button>
        </div>
      </div>
    );
  }

  const symbol = tokenSymbol(invoice.token);
  const selectedRoute = routePlan?.routes.find((route) => route.id === selectedRouteId) ?? null;
  const selectedRouteIsExternal = Boolean(selectedRoute?.actions.some((action) => action.type === 'external_checkout' && action.url));
  // Balance-aware "No QIE for gas" state.
  const gaslessRoute = routePlan?.routes.find((route) => route.requiresNativeGas === false && route.state === 'ready') ?? null;
  const hasNativeGas = nativeBalance ? nativeBalance.value > 0n : null; // null while unknown
  const selectedNeedsGas = selectedRoute ? selectedRoute.requiresNativeGas !== false : true;
  const noGasForGas = isConnected && hasNativeGas === false && selectedNeedsGas;
  const acquisitionAvailable = (routePlan?.acquisitionRoutes ?? []).some((r) => r.state === 'available' && r.url);

  return (
    <div role="main" className="relative min-h-screen bg-bg-base text-white">
      <div className="qie-mesh-bg pointer-events-none absolute inset-0 opacity-50" />
      <div className="relative mx-auto max-w-4xl space-y-5 px-4 py-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-text-secondary">
            <Lock className="h-4 w-4 text-primary" />
            <div>
              <div className="font-bold tracking-tight text-white">Qantara checkout</div>
              <div className="text-[10px] uppercase tracking-widest text-text-muted">QIE Mainnet - backend verified invoice</div>
            </div>
          </div>
          <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest ${getCheckoutBadgeClass()}`}>
            {getCheckoutBadge()}
          </span>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr] lg:items-start">
          {/* ── LEFT: the payment action ─────────────────────────────────── */}
          <div className="space-y-4 lg:sticky lg:top-6">
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              className="space-y-3 rounded-2xl border border-border-default bg-surface-1 p-8 text-center">
              <div className="text-[10px] uppercase tracking-widest text-text-muted">Pay</div>
              <div className="flex items-baseline justify-center gap-2">
                <span className="text-5xl font-bold tracking-tight">{invoice.amount}</span>
                <span className="text-xl text-text-secondary">{symbol}</span>
              </div>
              {invoice.title && <div className="text-sm text-white">{invoice.title}</div>}
              {invoice.memo && <div className="mx-auto max-w-xs text-xs text-text-muted">{invoice.memo}</div>}

              <div className="mt-4 space-y-2 border-t border-border-default pt-4 text-left">
                <Row label="To" value={
                  <a href={`${explorerUrl}/address/${invoice.merchant}`} target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1 font-mono text-xs hover:text-primary">
                    {invoice.merchant.slice(0, 6)}...{invoice.merchant.slice(-4)} <ExternalLink className="h-3 w-3" />
                  </a>
                } />
                {invoice.expiresAt > 0 && (
                  <Row label="Expires" value={<span className="text-xs"><Clock className="mr-1 inline h-3 w-3" />{fullDateFormatter.format(new Date(invoice.expiresAt * 1000))}</span>} />
                )}
                <Row label="Invoice" value={
                  <button
                    type="button"
                    onClick={handleCopyInvoiceHash}
                    className="inline-flex items-center gap-1 font-mono text-xs hover:text-primary"
                    title="Copy invoice hash"
                    aria-label="Copy invoice hash"
                  >
                    {invoice.hash.slice(0, 10)}...{invoice.hash.slice(-6)} {copiedTarget === 'hash' ? <CheckCircle className="h-3 w-3 text-primary" /> : <Copy className="h-3 w-3" />}
                  </button>
                } />
              </div>
            </motion.div>

            {noGasForGas && (
              <GaslessNudge
                amount={invoice.amount}
                symbol={symbol}
                gaslessAvailable={Boolean(gaslessRoute)}
                selectedIsGasless={selectedRoute?.requiresNativeGas === false}
                acquisitionAvailable={acquisitionAvailable}
                onUseGasless={() => {
                  if (!gaslessRoute) return;
                  manualRouteRef.current = true;
                  setSelectedRouteId(gaslessRoute.id);
                }}
                onGetQie={scrollToAcquire}
                onContactMerchant={scrollToDealRoom}
              />
            )}

            {/* Acquisition rails surface only when the payer actually needs QIE. */}
            {noGasForGas && (
              <div id="acquire-qie" className="scroll-mt-6">
                <AcquisitionRoutesPanel
                  routes={routePlan?.acquisitionRoutes ?? []}
                  symbol={symbol}
                  mintingRouteId={mintingRouteId}
                  onMintQusdc={(route) => void handleMintQusdc(route)}
                />
              </div>
            )}

            {wrongNetwork && canPay && (
              <CheckoutAlert
                icon={<AlertTriangle className="h-5 w-5" />}
                title="Wrong wallet network"
                tone="warning"
                body={`This checkout accepts payment only on QIE Mainnet, chain ${qieMainnet.id}. Switch networks before submitting a transaction.`}
              />
            )}

            {payStatus === 'already-paid' || payStatus === 'success' ? (
              <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                className="space-y-2 rounded-2xl border border-primary/30 bg-primary/5 p-6 text-center">
                <CheckCircle className="mx-auto h-8 w-8 text-primary" />
                <div className="font-bold">Payment confirmed</div>
                {invoice.payer && <div className="text-xs text-text-muted">By {invoice.payer.slice(0, 6)}...{invoice.payer.slice(-4)}</div>}
                {txHash && (
                  <a href={`${explorerUrl}/tx/${txHash}`} target="_blank" rel="noreferrer"
                    className="mt-2 block font-mono text-xs text-text-muted hover:text-primary">
                    Tx: {txHash.slice(0, 14)}...
                  </a>
                )}
                {invoice.has_success_url && QANTARA_BACKEND_URL && (
                  <a
                    href={`${QANTARA_BACKEND_URL}/v1/invoices/${invoice.hash}/return?type=success`}
                    className="mt-3 inline-flex items-center justify-center gap-1 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-white transition hover:opacity-90"
                  >
                    Return to merchant
                  </a>
                )}
              </motion.div>
            ) : payStatus === 'expired' ? (
              <CheckoutAlert
                icon={<Clock className="h-5 w-5" />}
                title="Invoice expired"
                tone="warning"
                body="This invoice can no longer be paid. Ask the merchant to issue a current invoice."
              />
            ) : payStatus === 'error' ? (
              <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-center text-sm text-red-300">
                <XCircle className="mx-auto mb-1 h-5 w-5" /> {payError}
                {wrongNetwork && (
                  <Button size="sm" className="mt-3" loading={isSwitchingChain} onClick={() => void switchChainAsync({ chainId: qieMainnet.id })}>
                    Switch to QIE Mainnet
                  </Button>
                )}
              </div>
            ) : !isConnected && !selectedRouteIsExternal ? (
              <Button size="lg" className="w-full" onClick={() => setIsWalletModalOpen(true)}>Connect wallet to pay</Button>
            ) : routePlanBlocksPayment || routePlanError || !selectedRoute ? (
              <Button size="lg" className="w-full" disabled>
                {routePlanError ? 'Payment route unavailable' : routePlan?.reason || 'No payable route'}
              </Button>
            ) : wrongNetwork && !selectedRouteIsExternal ? (
              <Button size="lg" className="w-full" loading={isSwitchingChain} onClick={() => void switchChainAsync({ chainId: qieMainnet.id })}>
                Switch to QIE Mainnet
              </Button>
            ) : (
              <Button size="lg" className="w-full" loading={payStatus === 'paying' || payStatus === 'verifying'} onClick={handlePay}>
                {payStatus === 'verifying' ? 'Verifying on RPC...' : payStatus === 'paying' ? 'Waiting for wallet...' : selectedRouteIsExternal ? `Open ${selectedRoute.label}` : `Pay with ${selectedRoute.label}`}
              </Button>
            )}

            {canPay && (
              <button
                type="button"
                onClick={() => { setChatOpen(true); setTimeout(scrollToDealRoom, 60); }}
                className="flex w-full items-center justify-center gap-2 rounded-2xl border border-border-default bg-surface-1 px-4 py-3 text-sm font-bold text-text-secondary transition-colors hover:border-primary/40 hover:text-primary"
              >
                <MessageSquare className="h-4 w-4" />
                Ask merchant before paying
              </button>
            )}
          </div>

          {/* ── RIGHT: context, trust, share, chat ───────────────────────── */}
          <div className="space-y-4">
            <TrustHeader invoice={invoice} status={payStatus} />

            <details className="group overflow-hidden rounded-2xl border border-border-default bg-surface-1/60">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-bold text-text-secondary transition-colors hover:text-white [&::-webkit-details-marker]:hidden">
                <span>Network, route &amp; trust details</span>
                <span className="text-text-muted transition-transform group-open:rotate-180">▾</span>
              </summary>
              <div className="space-y-3 border-t border-border-default p-3">
                <PaymentRoutePanel
                  plan={routePlan}
                  selectedRouteId={selectedRouteId}
                  isLoading={routePlanLoading}
                  error={routePlanError}
                  qusdcCapabilities={qusdcCapabilities}
                  qusdcCapabilitiesError={qusdcCapabilitiesError}
                  onSelectRoute={(routeId) => { manualRouteRef.current = true; setSelectedRouteId(routeId); }}
                />
                <QieNetworkPanel
                  catalog={networkCatalog}
                  catalogError={networkCatalogError}
                  backendHealth={backendHealth}
                  backendHealthError={backendHealthError}
                  backendHealthLoading={backendHealthLoading}
                  onRefresh={() => void refreshBackendHealth()}
                />
                <MerchantTrustBadges merchant={invoice.merchant} />
                <LiveStatusStrip status={payStatus} events={liveEvents} streamStatus={streamStatus} lastStreamEventAt={lastStreamEventAt} />
                <PayTrustRail invoice={invoice} />
                <WalletHealthCard compact />
              </div>
            </details>

            <SharePanel
              payUrl={payUrl}
              qrOpen={qrOpen}
              copied={copiedTarget === 'link'}
              onToggleQr={() => setQrOpen((current) => !current)}
              onCopy={handleCopyLink}
              onShare={() => void handleShareLink()}
            />

            <div id="deal-room" ref={dealRoomRef} className="scroll-mt-6 space-y-3">
              <button
                type="button"
                onClick={() => setChatOpen((o) => !o)}
                className="flex w-full items-center justify-between gap-2 rounded-2xl border border-border-default bg-surface-1/60 px-4 py-3 text-sm font-bold text-text-secondary transition-colors hover:text-white"
              >
                <span className="flex items-center gap-2"><MessageSquare className="h-4 w-4 text-primary" /> Ask merchant · chat &amp; resolution</span>
                <span className={`text-text-muted transition-transform ${chatOpen ? 'rotate-180' : ''}`}>▾</span>
              </button>
              {chatOpen && (
                <DealRoomPanel invoiceHash={invoice.hash} role="payer" title="Ask merchant about this invoice" />
              )}
            </div>
          </div>
        </div>

        <p className="text-center text-[10px] text-text-muted">Non-custodial payments on QIE Mainnet - chain {qieMainnet.id}</p>
      </div>

      <WalletModal isOpen={isWalletModalOpen} onClose={() => setIsWalletModalOpen(false)} />
    </div>
  );
}

function QieNetworkPanel({
  catalog,
  catalogError,
  backendHealth,
  backendHealthError,
  backendHealthLoading,
  onRefresh,
}: {
  catalog: QieNetworkCatalog | null;
  catalogError: string | null;
  backendHealth: BackendHealth | null;
  backendHealthError: string | null;
  backendHealthLoading: boolean;
  onRefresh: () => void;
}) {
  const active = catalog?.networks.find((network) => network.key === catalog.activeNetwork) ?? catalog?.networks[0] ?? null;
  const testnet = catalog?.networks.find((network) => network.key === 'qie-testnet') ?? null;
  const rpcOk = Boolean(backendHealth?.rpc?.ok);
  const activeEndpoint = backendHealth?.rpc?.url || active?.rpcUrls.find((rpc) => rpc.preferred)?.url || active?.rpcUrls[0]?.url || 'not reported';
  return (
    <section className="space-y-3 rounded-2xl border border-border-default bg-surface-1 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-bold text-white">
            {rpcOk ? <CheckCircle className="h-4 w-4 text-primary" /> : <AlertTriangle className="h-4 w-4 text-yellow-300" />}
            QIE network
          </div>
          <p className="mt-0.5 text-xs text-text-muted">
            RPC and explorer metadata come from backend catalog and health checks.
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          className="rounded-lg border border-border-default bg-surface-2 px-2 py-1 text-[10px] font-bold uppercase text-text-muted hover:border-primary/30 hover:text-primary"
        >
          {backendHealthLoading ? 'checking' : 'refresh'}
        </button>
      </div>
      {(catalogError || backendHealthError) && (
        <div className="rounded-xl border border-yellow-400/20 bg-yellow-400/8 px-3 py-2 text-xs text-yellow-100">
          {catalogError || backendHealthError}
        </div>
      )}
      <div className="grid gap-2 text-xs sm:grid-cols-2">
        <TrustItem label="Active chain" value={active ? `${active.name} (${active.chainId})` : 'catalog unavailable'} />
        <TrustItem label="RPC health" value={rpcOk ? `block ${backendHealth?.rpc?.blockNumber ?? 'unknown'}` : backendHealth?.rpc?.error || 'not verified'} />
        <TrustItem label="Active endpoint" value={activeEndpoint} />
        <TrustItem label="RPC candidates" value={active ? `${active.rpcUrls.length} configured` : 'unavailable'} />
      </div>
      <div className="flex flex-wrap gap-2">
        {active && (
          <a href={active.explorer.baseUrl} target="_blank" rel="noreferrer">
            <Button variant="ghost" size="sm"><ExternalLink className="h-4 w-4" /> Explorer</Button>
          </a>
        )}
        {testnet?.faucetUrl && (
          <a href={testnet.faucetUrl} target="_blank" rel="noreferrer">
            <Button variant="ghost" size="sm"><Fuel className="h-4 w-4" /> Testnet faucet</Button>
          </a>
        )}
      </div>
    </section>
  );
}

function AcquisitionRoutesPanel({
  routes,
  symbol,
  mintingRouteId,
  onMintQusdc,
}: {
  routes: PaymentRoutePlan['acquisitionRoutes'];
  symbol: 'QIE' | 'QUSDC';
  mintingRouteId: string | null;
  onMintQusdc: (route: PayAcquisitionRoute) => void;
}) {
  if (!routes.length) return null;
  const enabled = routes.filter((route) => route.state === 'available' && (route.actionType === 'contract_mint' || route.url));
  return (
    <section className="space-y-2 rounded-2xl border border-secondary/20 bg-secondary/5 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-bold text-white">Need {symbol}?</div>
          <p className="mt-0.5 text-xs text-text-muted">
            Acquisition routes come from the backend QIE ecosystem registry. Payment status still changes only after RPC verification.
          </p>
        </div>
        <span className="rounded-full bg-secondary/15 px-2 py-1 text-[10px] font-bold uppercase text-secondary">
          {enabled.length}/{routes.length} ready
        </span>
      </div>
      <div className="grid gap-2">
        {routes.map((route) => {
          const isContractMint = route.actionType === 'contract_mint';
          const isReady = route.state === 'available' && (isContractMint || !!route.url);
          const content = (
            <div className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-xs transition ${
              isReady ? 'border-secondary/20 bg-surface-1 text-text-secondary hover:border-secondary/40' : 'border-yellow-400/15 bg-yellow-400/8 text-yellow-100'
            }`}>
              <div className="min-w-0">
                <div className="truncate font-bold text-white">{route.label}</div>
                <div className="truncate text-[11px] text-text-muted">{route.reason}</div>
              </div>
              {isContractMint && mintingRouteId === route.id
                ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-secondary" />
                : isReady
                  ? isContractMint ? <Zap className="h-3.5 w-3.5 shrink-0 text-secondary" /> : <ExternalLink className="h-3.5 w-3.5 shrink-0 text-secondary" />
                  : <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-yellow-300" />}
            </div>
          );
          if (isReady && isContractMint) {
            return (
              <button key={route.id} type="button" disabled={mintingRouteId === route.id} onClick={() => onMintQusdc(route)} className="block w-full text-left disabled:cursor-wait disabled:opacity-70">
                {content}
              </button>
            );
          }
          return isReady ? (
            <a key={route.id} href={route.url!} target="_blank" rel="noreferrer" title={route.reason}>
              {content}
            </a>
          ) : (
            <div key={route.id}>{content}</div>
          );
        })}
      </div>
    </section>
  );
}

function GaslessNudge({
  amount,
  symbol,
  gaslessAvailable,
  selectedIsGasless,
  acquisitionAvailable,
  onUseGasless,
  onGetQie,
  onContactMerchant,
}: {
  amount: string;
  symbol: 'QIE' | 'QUSDC';
  gaslessAvailable: boolean;
  selectedIsGasless: boolean;
  acquisitionAvailable: boolean;
  onUseGasless: () => void;
  onGetQie: () => void;
  onContactMerchant: () => void;
}) {
  if (gaslessAvailable) {
    return (
      <section className="space-y-3 rounded-2xl border border-primary/40 bg-primary/10 p-4">
        <div className="flex items-start gap-3">
          <Zap className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-white">No QIE for gas? You don&apos;t need any.</h3>
            <p className="mt-0.5 text-xs text-text-secondary">
              Pay {amount} {symbol} with no native QIE gas — the configured paymaster sponsors the gas and Qantara
              still settles only after on-chain RPC verification.
            </p>
          </div>
        </div>
        {selectedIsGasless ? (
          <div className="flex items-center gap-2 rounded-xl border border-primary/20 bg-primary/8 px-3 py-2 text-xs text-primary">
            <BadgeCheck className="h-4 w-4 shrink-0" /> Gasless QUSDC route selected — no QIE required to pay.
          </div>
        ) : (
          <Button size="sm" onClick={onUseGasless} className="w-full sm:w-auto">
            <Zap className="h-4 w-4" /> Pay {symbol} without QIE gas
          </Button>
        )}
      </section>
    );
  }

  return (
    <section className="space-y-3 rounded-2xl border border-yellow-400/30 bg-yellow-400/8 p-4">
      <div className="flex items-start gap-3">
        <Fuel className="mt-0.5 h-5 w-5 shrink-0 text-yellow-300" />
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-white">You need QIE for gas to pay on-chain</h3>
          <p className="mt-0.5 text-xs text-text-secondary">
            This route settles through a wallet transaction, which needs a little native QIE for gas. No gasless
            paymaster route is available for this invoice yet — get some QIE, or reach the merchant.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {acquisitionAvailable && (
          <Button size="sm" onClick={onGetQie}>
            <ExternalLink className="h-4 w-4" /> Get QIE for gas
          </Button>
        )}
        <Button size="sm" variant="secondary" onClick={onContactMerchant}>
          <MessageSquare className="h-4 w-4" /> Contact merchant
        </Button>
      </div>
      <p className="text-[11px] text-text-muted">
        Tip: if the merchant enables a gasless QUSDC rail, you&apos;ll be able to pay with no QIE at all.
      </p>
    </section>
  );
}

function PaymentRoutePanel({
  plan,
  selectedRouteId,
  isLoading,
  error,
  qusdcCapabilities,
  qusdcCapabilitiesError,
  onSelectRoute,
}: {
  plan: PaymentRoutePlan | null;
  selectedRouteId: string | null;
  isLoading: boolean;
  error: string | null;
  qusdcCapabilities: QusdcCapabilityProbe | null;
  qusdcCapabilitiesError: string | null;
  onSelectRoute: (routeId: string) => void;
}) {
  const selected = plan?.routes.find((route) => route.id === selectedRouteId) ?? null;
  const readyRoutes = plan?.routes.filter((route) => route.state === 'ready').length ?? 0;
  const usesQusdc = plan?.token.symbol === 'QUSDC' || plan?.routes.some((route) => route.rail === 'QUSDC');

  return (
    <section className="space-y-3 rounded-2xl border border-border-default bg-surface-1 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 gap-2">
          <Route className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-white">Payment route</h3>
            <p className="mt-0.5 text-xs text-text-muted">
              Planned by backend from invoice, rails, registry, and RPC health.
            </p>
          </div>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold uppercase ${
          plan?.payable ? 'bg-primary/15 text-primary' : isLoading ? 'bg-secondary/15 text-secondary' : 'bg-yellow-400/10 text-yellow-300'
        }`}>
          {isLoading ? 'loading' : plan?.payable ? 'payable' : 'blocked'}
        </span>
      </div>

      {error && (
        <div className="flex gap-2 rounded-xl border border-yellow-400/20 bg-yellow-400/8 p-3 text-xs text-yellow-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-300" />
          <span>{error}</span>
        </div>
      )}

      {!error && !plan && (
        <div className="flex items-center gap-2 rounded-xl border border-border-default bg-surface-2 p-3 text-xs text-text-muted">
          <Loader2 className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          <span>{isLoading ? 'Loading route plan from backend...' : 'Route plan has not loaded yet.'}</span>
        </div>
      )}

      {plan && (
        <>
          <div className="grid gap-2 text-xs sm:grid-cols-2">
            <TrustItem label="Route state" value={plan.reason ?? plan.state} />
            <TrustItem label="Ready routes" value={`${readyRoutes}/${plan.routes.length}`} />
            <TrustItem label="Token" value={`${plan.amount} ${plan.token.symbol}`} />
          </div>

          {plan.routes.length === 0 ? (
            <div className="rounded-xl border border-yellow-400/20 bg-yellow-400/8 p-3 text-xs text-yellow-100">
              No configured payment rail supports this invoice token.
            </div>
          ) : (
            <div className="space-y-2">
              {plan.routes.map((route) => (
                <RouteChoice
                  key={route.id}
                  route={route}
                  selected={route.id === selectedRouteId}
                  onSelect={() => onSelectRoute(route.id)}
                />
              ))}
            </div>
          )}

          {selected && (
            <div className="space-y-2 rounded-xl border border-primary/15 bg-primary/5 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-bold text-primary">Selected route</div>
                <div className="text-[10px] uppercase tracking-widest text-text-muted">{selected.id}</div>
              </div>
              {selected.actions.map((action, index) => (
                <div key={`${selected.id}-${action.type}-${index}`} className="flex items-center justify-between gap-3 rounded-lg bg-surface-1 px-3 py-2 text-[11px]">
                  <span className="text-text-secondary">{index + 1}. {action.label}</span>
                  <code className="max-w-[42%] truncate text-text-muted">{action.method ?? action.type}</code>
                </div>
              ))}
              {selected.requiresNativeGas === false && (
                <div className="rounded-lg border border-primary/20 bg-primary/8 px-3 py-2 text-[11px] text-primary">
                  No native QIE gas is required in Qantara. The configured paymaster flow handles gas sponsorship and Qantara waits for backend/RPC verification.
                </div>
              )}
              {selected.provider && (
                <TrustItem label="Provider" value={selected.provider} />
              )}
              {selected.fallbackRouteIds && selected.fallbackRouteIds.length > 0 && (
                <TrustItem label="Fallbacks" value={selected.fallbackRouteIds.join(' / ')} />
              )}
            </div>
          )}

          {usesQusdc && (
            <div className="space-y-2 rounded-xl border border-border-default bg-surface-2 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-bold text-white">QUSDC capability probe</div>
                  <div className="mt-0.5 text-[10px] uppercase tracking-widest text-text-muted">
                    Backend RPC contract read
                  </div>
                </div>
                <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase ${
                  qusdcCapabilities?.status === 'ready'
                    ? 'bg-primary/15 text-primary'
                    : qusdcCapabilities?.status === 'degraded'
                      ? 'bg-yellow-400/10 text-yellow-300'
                      : 'bg-surface-1 text-text-muted'
                }`}>
                  {qusdcCapabilities?.status ?? 'loading'}
                </span>
              </div>
              {qusdcCapabilitiesError && (
                <div className="rounded-lg border border-yellow-400/20 bg-yellow-400/8 px-3 py-2 text-xs text-yellow-100">
                  {qusdcCapabilitiesError}
                </div>
              )}
              {qusdcCapabilities && (
                <>
                  <div className="grid gap-2 text-xs sm:grid-cols-3">
                    <TrustItem label="Token" value={qusdcCapabilities.metadata.symbol ?? 'unknown'} />
                    <TrustItem label="Decimals" value={qusdcCapabilities.metadata.decimals?.toString() ?? 'unknown'} />
                    <TrustItem label="Address" value={qusdcCapabilities.address ? `${qusdcCapabilities.address.slice(0, 8)}...${qusdcCapabilities.address.slice(-6)}` : 'not configured'} />
                  </div>
                  <div className="grid gap-2 text-xs sm:grid-cols-2">
                    <CapabilityPill ok={qusdcCapabilities.capabilities.erc20Transfer} label="ERC20 transfer" detail="standard transfer path" />
                    <CapabilityPill ok={qusdcCapabilities.capabilities.approveAndPay} label="Approve + pay" detail="allowance then contract pay" />
                    <CapabilityPill ok={qusdcCapabilities.capabilities.permit.supported} label="Permit" detail={qusdcCapabilities.capabilities.permit.reason} />
                    <CapabilityPill ok={qusdcCapabilities.capabilities.eip3009.supported} label="EIP-3009" detail={qusdcCapabilities.capabilities.eip3009.reason} />
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function CapabilityPill({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div className={`rounded-xl border px-3 py-2 ${
      ok ? 'border-primary/20 bg-primary/8 text-primary' : 'border-yellow-400/20 bg-yellow-400/8 text-yellow-100'
    }`}>
      <div className="text-[10px] font-bold uppercase tracking-widest">{label}</div>
      <div className="mt-1 line-clamp-2 text-[11px] text-text-secondary">{detail}</div>
    </div>
  );
}

function RouteChoice({
  route,
  selected,
  onSelect,
}: {
  route: PaymentRouteCandidate;
  selected: boolean;
  onSelect: () => void;
}) {
  const ready = route.state === 'ready';
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={!ready}
      className={`w-full rounded-xl border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
        selected
          ? 'border-primary/50 bg-primary/10'
          : 'border-border-default bg-surface-2 hover:border-primary/30'
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-bold text-white">{route.label}</div>
          <div className="mt-0.5 truncate text-xs text-text-muted">
            {route.method} - {route.rail}{route.requiresNativeGas === false ? ' - no QIE gas' : ''}
          </div>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold uppercase ${
          ready ? 'bg-primary/15 text-primary' : 'bg-yellow-400/10 text-yellow-300'
        }`}>
          {route.recommended && ready ? 'recommended' : route.state}
        </span>
      </div>
      <p className="mt-2 text-xs text-text-muted">{route.reason}</p>
      <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-bold uppercase tracking-widest">
        {route.requiresNativeGas === false && (
          <span className="rounded-full bg-primary/10 px-2 py-1 text-primary">No QIE gas</span>
        )}
        {route.provider && (
          <span className="rounded-full bg-secondary/10 px-2 py-1 text-secondary">{route.provider}</span>
        )}
        {route.explorer.tokenUrl && (
          <a href={route.explorer.tokenUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-text-muted hover:text-primary" onClick={(event) => event.stopPropagation()}>
            Token <ExternalLink className="h-3 w-3" />
          </a>
        )}
        {route.explorer.settlementContractUrl && (
          <a href={route.explorer.settlementContractUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-text-muted hover:text-primary" onClick={(event) => event.stopPropagation()}>
            Contract <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    </button>
  );
}

function TrustHeader({ invoice, status }: { invoice: QantaraInvoice; status: PayStatus }) {
  const symbol = tokenSymbol(invoice.token);
  const expired = invoice.expiresAt > 0 && Math.floor(Date.now() / 1000) > invoice.expiresAt;
  const paid = invoice.status === InvoiceStatus.Paid || status === 'success' || status === 'already-paid';
  return (
    <section className="grid gap-2 rounded-2xl border border-border-default bg-surface-1 p-4 text-xs">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-bold text-white">Trust checks</div>
          <div className="mt-0.5 text-[10px] uppercase tracking-widest text-text-muted">Loaded from the configured Qantara API</div>
        </div>
        <span className={paid ? 'text-primary' : expired ? 'text-yellow-300' : 'text-secondary'}>
          {paid ? 'Paid' : expired ? 'Expired' : 'Open'}
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <TrustItem label="Merchant" value={`${invoice.merchant.slice(0, 6)}...${invoice.merchant.slice(-4)}`} />
        <TrustItem label="Token" value={symbol} />
        <TrustItem label="Chain" value={`QIE Mainnet ${qieMainnet.id}`} />
        <TrustItem label="Source" value={invoice.metadata?.chain_tx_hash ? 'On-chain invoice' : 'RPC verified transfer'} />
      </div>
    </section>
  );
}

function CheckoutAlert({
  icon,
  title,
  body,
  tone,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  tone: 'warning' | 'danger';
}) {
  const classes = tone === 'warning'
    ? 'border-yellow-500/30 bg-yellow-500/10 text-yellow-200'
    : 'border-red-500/30 bg-red-500/10 text-red-200';

  return (
    <div className={`flex gap-3 rounded-2xl border p-4 text-sm ${classes}`}>
      <div className="mt-0.5 shrink-0">{icon}</div>
      <div>
        <div className="font-bold text-white">{title}</div>
        <p className="mt-1 text-xs leading-relaxed opacity-90">{body}</p>
      </div>
    </div>
  );
}

function SharePanel({
  payUrl,
  qrOpen,
  copied,
  onToggleQr,
  onCopy,
  onShare,
}: {
  payUrl: string;
  qrOpen: boolean;
  copied: boolean;
  onToggleQr: () => void;
  onCopy: () => void;
  onShare: () => void;
}) {
  return (
    <section className="rounded-2xl border border-border-default bg-surface-1 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-white">Share checkout</h3>
          <p className="mt-0.5 text-xs text-text-muted">Use the backend invoice URL or scan the QR code.</p>
        </div>
        <div className="flex shrink-0 gap-1">
          <IconControl
            title={qrOpen ? 'Hide QR code' : 'Show QR code'}
            ariaLabel={qrOpen ? 'Hide QR code' : 'Show QR code'}
            onClick={onToggleQr}
          >
            <QrCode className="h-4 w-4" />
          </IconControl>
          <IconControl title="Copy payment link" ariaLabel="Copy payment link" onClick={onCopy}>
            {copied ? <CheckCircle className="h-4 w-4 text-primary" /> : <Copy className="h-4 w-4" />}
          </IconControl>
          <IconControl title="Share payment link" ariaLabel="Share payment link" onClick={onShare}>
            <Share2 className="h-4 w-4" />
          </IconControl>
        </div>
      </div>
      {qrOpen && (
        <div className="mt-4 flex justify-center">
          <div className="rounded-xl bg-white p-4">
            <QRCodeSVG value={payUrl} size={180} bgColor="#ffffff" fgColor="#0d0a18" />
          </div>
        </div>
      )}
    </section>
  );
}

function IconControl({
  title,
  ariaLabel,
  onClick,
  children,
}: {
  title: string;
  ariaLabel: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={ariaLabel}
      className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border-default bg-surface-2 text-text-secondary transition-colors hover:border-primary/40 hover:text-primary"
    >
      {children}
    </button>
  );
}

function TrustItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border-default bg-surface-2 px-3 py-2">
      <div className="text-[10px] uppercase tracking-widest text-text-muted">{label}</div>
      <div className="mt-1 truncate font-bold text-white">{value}</div>
    </div>
  );
}

function LiveStatusStrip({
  status,
  events,
  streamStatus,
  lastStreamEventAt,
}: {
  status: PayStatus;
  events: Array<{ type: string; createdAt: number; payload: Record<string, unknown> }>;
  streamStatus: 'disabled' | 'connecting' | 'connected' | 'error';
  lastStreamEventAt: number | null;
}) {
  const latest = events.slice().reverse().find((event) =>
    ['invoice.viewed', 'message.created', 'invoice.paid', 'receipt.created', 'webhook.failed'].includes(event.type),
  );
  const label = status === 'paying'
    ? 'Payment submitted from wallet'
    : status === 'verifying'
      ? 'Verifying on QIE RPC'
      : latest?.type === 'message.created'
        ? `Merchant replied: ${String(latest.payload.preview || 'new message')}`
        : latest?.type === 'invoice.paid'
          ? 'Payment confirmed by backend'
          : latest?.type === 'receipt.created'
            ? 'Receipt is ready'
            : streamStatus === 'connected'
              ? 'Live invoice updates connected'
              : streamStatus === 'connecting'
                ? 'Connecting invoice updates'
                : streamStatus === 'error'
                  ? 'Live updates paused. Manual refresh is available.'
                  : 'Invoice updates refresh automatically';

  const lastSeenAt = latest?.createdAt ?? lastStreamEventAt;

  return (
    <div className="flex items-center gap-2 rounded-2xl border border-primary/20 bg-primary/5 px-4 py-2.5 text-xs text-text-secondary">
      <span className={`h-2 w-2 rounded-full ${streamStatus === 'error' ? 'bg-yellow-300' : 'bg-primary animate-pulse'}`} />
      <span aria-live="polite">{label}</span>
      {lastSeenAt && <span className="ml-auto text-text-muted">{timeFormatter.format(new Date(lastSeenAt * 1000))}</span>}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-text-muted">{label}</span>
      <span className="text-white">{value}</span>
    </div>
  );
}

/** Payer-facing merchant trust signals (wallet / domain / Telegram verified). */
function MerchantTrustBadges({ merchant }: { merchant: string }) {
  const [profile, setProfile] = useState<MerchantTrustProfile | null>(null);
  useEffect(() => {
    let active = true;
    getPublicMerchantProfile(merchant).then((p) => { if (active) setProfile(p); }).catch(() => undefined);
    return () => { active = false; };
  }, [merchant]);

  if (!profile) return null;
  const badges: Array<{ ok: boolean; label: string }> = [
    { ok: profile.trust.walletVerified, label: 'Wallet verified' },
    { ok: profile.trust.domainVerified, label: profile.trust.domain ? `Domain: ${profile.trust.domain}` : 'Domain verified' },
    { ok: profile.trust.telegramVerified || !!profile.trust.telegramLinked, label: 'Telegram linked' },
    { ok: !!profile.trust.pass?.verified, label: 'QIE Pass verified' },
  ].filter((b) => b.ok);
  const recentPaid = profile.recentPaidCount ?? profile.recentPaid ?? 0;
  if (badges.length === 0 && !profile.displayName && recentPaid === 0) return null;

  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {profile.displayName && <span className="text-sm font-bold text-white">{profile.displayName}</span>}
      {badges.map((b) => (
        <span key={b.label} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-bold text-primary">
          <BadgeCheck className="h-3 w-3" /> {b.label}
        </span>
      ))}
      {recentPaid > 0 && (
        <a
          href={profile.explorerUrl ?? `${qieMainnet.blockExplorers.default.url}/address/${merchant}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-[11px] font-bold text-text-secondary hover:text-primary"
        >
          {recentPaid} paid
          <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </div>
  );
}
