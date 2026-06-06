import { motion, AnimatePresence } from 'framer-motion';
import {
  Shield, Lock, CheckCircle, Loader2,
  ArrowRight, ArrowLeft, Terminal, Eye, Copy, QrCode
} from 'lucide-react';
import { QRDisplay } from '../../components/QRDisplay';
import { buildEip681, buildQantaraLink } from '../../lib/eip681';
import { useState } from 'react';
import { Button } from '../../components/Button';
import { useToastStore } from '../../components/ToastContainer';
import { useNavigate } from 'react-router-dom';
import { useAccount, useWriteContract, usePublicClient, useSignMessage, useSwitchChain } from 'wagmi';
import { describeTxError } from '../../lib/walletErrors';
import { AmountInput } from '../../components/AmountInput';
import { DatePicker } from '../../components/DatePicker';
import { isValidAmount } from '../../utils/validation';
import { keccak256, parseEther, parseUnits, toHex, type Hex } from 'viem';
import { canonicalInvoiceCreateMessage, createInvoice, getAuthNonce, InvoiceType } from '../../lib/qantaraApi';
import { QANTARA_ADDRESS, QUSDC_ADDRESS } from '../../lib/dealRoom';
import { qantaraAbi } from '../../lib/qantaraAbi';
import { qieMainnet } from '../../config/wagmi';
import { useAppPreferencesStore } from '../../store/useInvoiceStore';

function hashMetadata(meta: Record<string, unknown>): `0x${string}` {
  const json = JSON.stringify(meta, Object.keys(meta).sort());
  return keccak256(toHex(json));
}

type CipherType = 'standard' | 'donation';

interface FormData {
  amount: string;
  token: 'QIE' | 'QUSDC';
  memo: string;
  deadline: string;
  noDeadline: boolean;
}

const INITIAL_FORM: FormData = {
  amount: '', token: 'QIE', memo: '', deadline: '', noDeadline: false,
};

const INVOICE_TEMPLATES: Array<{
  id: string;
  label: string;
  description: string;
  type: CipherType;
  amount: string;
  token: 'QIE' | 'QUSDC';
  memo: string;
  noDeadline: boolean;
}> = [
  {
    id: 'service-retainer',
    label: 'Service retainer',
    description: 'One payer, clear memo, 7-day payment window.',
    type: 'standard',
    amount: '25',
    token: 'QIE',
    memo: 'Service retainer',
    noDeadline: false,
  },
  {
    id: 'digital-product',
    label: 'Digital product',
    description: 'Checkout-ready invoice for a fixed product sale.',
    type: 'standard',
    amount: '10',
    token: 'QIE',
    memo: 'Digital product purchase',
    noDeadline: false,
  },
  {
    id: 'community-donation',
    label: 'Community donation',
    description: 'Open-ended donation link with no expiry.',
    type: 'donation',
    amount: '0',
    token: 'QIE',
    memo: 'Community donation',
    noDeadline: true,
  },
];

export function NewCipher() {
  const { defaultToken, setDefaultToken } = useAppPreferencesStore();
  const [step, setStep] = useState(1);
  const [type, setType] = useState<CipherType>('standard');
  const [formData, setFormData] = useState<FormData>(() => ({ ...INITIAL_FORM, token: defaultToken }));
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [isDeploying, setIsDeploying] = useState(false);
  const [deployLogs, setDeployLogs] = useState<string[]>([]);
  const [deployedHash, setDeployedHash] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, boolean>>({});
  // Invoice metadata is stored in the backend; payment settlement is verified through QIE RPC.
  const { addToast } = useToastStore();
  const navigate = useNavigate();
  const { address, chainId } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const { signMessageAsync } = useSignMessage();
  const { switchChainAsync } = useSwitchChain();
  const publicClient = usePublicClient({ chainId: qieMainnet.id });
  // Invoice persistence is handled by the backend API; payments are verified through QIE RPC.

  // Qantara V1 create flow uses the deployed invoice contract.
  // Advanced flows live on their dedicated product pages.
  const types: { id: CipherType; label: string; icon: any; color: string; desc?: string }[] = [
    { id: 'standard', label: 'Standard', icon: Shield, color: 'text-primary', desc: 'One-time payment from one payer' },
    { id: 'donation', label: 'Donation', icon: Eye, color: 'text-pink-500', desc: 'Open-ended, no target — creator sweeps anytime' },
  ];

  const typeToUint8 = (t: CipherType): number => {
    return t === 'donation' ? InvoiceType.Donation : InvoiceType.Standard;
  };

  const addLog = (log: string) => setDeployLogs(prev => [...prev, log]);

  const handleDeploy = async () => {
    if (!address) {
      addToast('error', 'Wallet not connected');
      return;
    }

    // Wrong network: invoices are created only on QIE Mainnet. Offer to switch instead of failing mid-call.
    if (chainId !== undefined && chainId !== qieMainnet.id) {
      try {
        await switchChainAsync({ chainId: qieMainnet.id });
      } catch (err) {
        addToast('error', `Switch your wallet to QIE Mainnet (chain ${qieMainnet.id}) to create an invoice. ${describeTxError(err).message}`);
        return;
      }
    }

    // Validate amount
    const amountCheck = isValidAmount(formData.amount);
    if (!amountCheck.valid) {
      setFieldErrors(prev => ({ ...prev, amount: true }));
      addToast('error', amountCheck.error || 'Invalid amount');
      return;
    }

    setIsDeploying(true);
    setDeployLogs([]);

    try {
      if (formData.token === 'QUSDC' && !QUSDC_ADDRESS) {
        addToast('error', 'QUSDC address is not configured');
        setIsDeploying(false);
        return;
      }

      addLog(`> Amount: ${formData.amount} ${formData.token}`);

      if (type !== 'standard' && type !== 'donation') {
        addToast('error', `${types.find((item) => item.id === type)?.label ?? 'This invoice type'} uses its dedicated contract page`);
        setIsDeploying(false);
        return;
      }
      if (!QANTARA_ADDRESS || !publicClient) {
        addToast('error', 'Qantara contract is not configured for invoice creation');
        setIsDeploying(false);
        return;
      }

      const metadata = {
        title: type === 'donation' ? 'Donation' : 'Invoice',
        description: formData.memo || undefined,
        locale: 'en',
        template: selectedTemplate ?? undefined,
        checkoutBranding: 'qantara-default',
      };
      const metadataHash = hashMetadata(metadata);

      const deadlineSeconds = formData.noDeadline || !formData.deadline
        ? 0
        : Math.floor(new Date(formData.deadline).getTime() / 1000);

      const fullMemo = formData.memo;

      const contractInvoiceType: 0 | 1 = type === 'standard' ? 0 : 1;
      const tokenSymbol: 'QIE' | 'QUSDC' = formData.token;
      const tokenAddr = tokenSymbol === 'QIE'
        ? ('0x0000000000000000000000000000000000000000' as `0x${string}`)
        : (QUSDC_ADDRESS as `0x${string}`);

      addLog('> Submitting invoice creation on QIE Mainnet...');
      const saltBytes = crypto.getRandomValues(new Uint8Array(32));
      const salt = toHex(saltBytes);

      const onChainHash = (await (publicClient as any).readContract({
        address: QANTARA_ADDRESS,
        abi: qantaraAbi,
        functionName: 'computeInvoiceHash',
        args: [address, salt as `0x${string}`],
      })) as Hex;
      addLog(`> Pre-computed hash: ${onChainHash}`);

      const amountWei = tokenSymbol === 'QIE'
        ? parseEther(formData.amount)
        : parseUnits(formData.amount, 6);

      const onChainTx = await writeContractAsync({
        account: address,
        chain: qieMainnet,
        address: QANTARA_ADDRESS,
        abi: qantaraAbi,
        functionName: 'createInvoice',
        args: [
          salt as `0x${string}`,
          tokenAddr,
          amountWei,
          BigInt(deadlineSeconds),
          metadataHash,
          contractInvoiceType,
        ],
      } as any);
      addLog(`> TX submitted: ${onChainTx}`);
      addLog('> Waiting for mainnet confirmation...');
      const receipt = await publicClient.waitForTransactionReceipt({ hash: onChainTx });
      addLog(`> Confirmed in block ${receipt.blockNumber}`);

      addLog('> Mirroring to backend API...');
      const invoiceType = typeToUint8(type) as 0 | 1 | 2 | 3 | 4;
      const merchantNonce = await getAuthNonce();
      const signedAt = Math.floor(Date.now() / 1000);
      const invoiceCreateMessage = canonicalInvoiceCreateMessage({
        merchant: address,
        token: tokenSymbol,
        amount: formData.amount,
        expiresAt: deadlineSeconds,
        invoiceType,
        title: metadata.title,
        memo: fullMemo,
        metadata,
        hash: onChainHash,
        chainTxHash: onChainTx,
        nonce: merchantNonce,
        signedAt,
      });
      addLog('> Requesting wallet signature for backend invoice record...');
      const merchantSignature = await signMessageAsync({
        account: address,
        message: invoiceCreateMessage,
      });
      const invoice = await createInvoice({
        merchant: address,
        token: tokenSymbol,
        amount: formData.amount,
        expiresAt: deadlineSeconds,
        invoiceType,
        title: metadata.title,
        memo: fullMemo,
        metadata,
        hash: onChainHash,
        chainTxHash: onChainTx,
        merchantSignature,
        merchantNonce,
        signedAt,
      });

      addLog(`> Invoice ready`);
      addLog(`> Invoice hash: ${invoice.hash}`);
      addLog(`> Share link: ${window.location.origin}/pay/${invoice.hash}`);
      if (onChainTx) addLog(`> Explorer: ${qieMainnet.blockExplorers.default.url}/tx/${onChainTx}`);

      setDeployedHash(invoice.hash);
      setIsDeploying(false);
      setStep(4);
      addToast('success', `${tokenSymbol} invoice created on-chain`);
    } catch (err: unknown) {
      const info = describeTxError(err);
      addLog(`> Error: ${info.message.slice(0, 120)}`);
      addToast(info.kind === 'rejected' ? 'info' : 'error', info.message.slice(0, 120));
      setIsDeploying(false);
      console.error('[Qantara] Deploy error:', err);
    }
  };

  const resetForm = () => {
    setStep(1);
    setFormData({ ...INITIAL_FORM, token: defaultToken });
    setSelectedTemplate(null);
    setDeployLogs([]);
    setDeployedHash(null);
  };

  // V1 form fields shown (per PLAN.md scenarios 1, 2, 8, 11, 15):
  const summaryFields = [
    formData.amount && `Amount: ${formData.amount} ${formData.token}`,
    type !== 'donation' && (formData.deadline || formData.noDeadline ? `Expires: ${formData.noDeadline ? 'never' : formData.deadline}` : null),
    formData.memo && `Memo: ${formData.memo}`,
  ].filter(Boolean);

  // Shareable links for the success view. Web URL works everywhere; EIP-681 pops a
  // prefilled wallet send; qantara:// is the canonical interoperable standard.
  const shareWebUrl = deployedHash ? `${window.location.origin}/pay/${deployedHash}?amount=${formData.amount}` : '';
  const shareTokenAddr = formData.token === 'QIE' ? undefined : (QUSDC_ADDRESS as `0x${string}` | undefined);
  const shareDecimals = formData.token === 'QIE' ? 18 : 6;
  const shareEip681 = address
    ? buildEip681({ to: address, amount: formData.amount || undefined, token: shareTokenAddr, chainId: 1990, decimals: shareDecimals })
    : undefined;
  const shareQantara = address && deployedHash
    ? buildQantaraLink({ to: address, amount: formData.amount || undefined, token: shareTokenAddr, chainId: 1990, invoiceHash: deployedHash, decimals: shareDecimals })
    : undefined;

  const applyTemplate = (templateId: string) => {
    const template = INVOICE_TEMPLATES.find((item) => item.id === templateId);
    if (!template) return;
    const deadline = template.noDeadline
      ? ''
      : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    setSelectedTemplate(template.id);
    setType(template.type);
    setDefaultToken(template.token);
    setFormData({
      amount: template.amount,
      token: template.token,
      memo: template.memo,
      deadline,
      noDeadline: template.noDeadline,
    });
    setFieldErrors({});
    addToast('success', `${template.label} template applied`);
  };

  return (
    <div className="max-w-3xl mx-auto space-y-12">
      <div className="space-y-2">
        <h1 className="text-4xl font-bold text-white tracking-tight">Create invoice</h1>
        <p className="text-text-secondary">
          Create a non-custodial payment invoice on QIE Mainnet · chain 1990
        </p>
      </div>

      {/* Step Indicator */}
      <div className="flex items-center gap-4">
        {[{ n: 1, l: 'Details' }, { n: 2, l: 'Review' }, { n: 3, l: 'Deploy' }].map(({ n, l }) => (
          <div key={n} className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold transition-all duration-300 ${
                step === n ? 'bg-primary text-black' : step > n ? 'bg-primary/20 text-primary' : 'bg-surface-2 text-text-muted border border-border-default'
              }`}>
                {step > n ? <CheckCircle className="w-5 h-5" /> : n}
              </div>
              <span className={`text-xs font-bold uppercase tracking-widest ${step >= n ? 'text-white' : 'text-text-muted'}`}>{l}</span>
            </div>
            {n < 3 && <div className={`w-12 h-[2px] rounded-full ${step > n ? 'bg-primary' : 'bg-border-default'}`} />}
          </div>
        ))}
      </div>

      <div className="bg-surface-1 border border-border-default rounded-[40px] p-10 shadow-2xl overflow-hidden min-h-[500px] flex flex-col">
        <AnimatePresence mode="wait">
          {/* STEP 1: Type + Details */}
          {step === 1 && (
            <motion.div key="step1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-10 flex-1">
              <div className="space-y-4">
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <h2 className="text-2xl font-bold text-white">Start from a template</h2>
                    <p className="mt-1 text-sm text-text-muted">Templates only prefill this real invoice form. Payment and receipt state still require QIE RPC verification.</p>
                  </div>
                  {selectedTemplate && (
                    <button type="button" onClick={() => setSelectedTemplate(null)} className="text-xs font-bold uppercase tracking-widest text-text-muted hover:text-primary">
                      Custom
                    </button>
                  )}
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  {INVOICE_TEMPLATES.map((template) => (
                    <button
                      key={template.id}
                      type="button"
                      onClick={() => applyTemplate(template.id)}
                      className={`rounded-2xl border p-4 text-left transition-all ${
                        selectedTemplate === template.id
                          ? 'border-primary bg-primary/10 text-white'
                          : 'border-border-default bg-surface-2 text-text-secondary hover:border-primary/30'
                      }`}
                    >
                      <div className="text-sm font-bold">{template.label}</div>
                      <div className="mt-1 text-xs leading-relaxed text-text-muted">{template.description}</div>
                      <div className="mt-3 text-[10px] font-bold uppercase tracking-widest text-primary">
                        {template.amount} {template.token}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Type Selector */}
              <div className="space-y-6">
                <h2 className="text-2xl font-bold text-white">Invoice type</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {types.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setType(t.id)}
                      className={`relative flex flex-col items-start text-left p-5 rounded-2xl border transition-all duration-300 gap-3 ${
                        type === t.id
                          ? 'bg-primary/10 border-primary text-white'
                          : 'bg-surface-2 border-border-default text-text-secondary hover:border-primary/40'
                      }`}
                    >
                      <t.icon className={`w-7 h-7 ${type === t.id ? t.color : 'text-inherit'}`} />
                      <div>
                        <div className="text-sm font-bold tracking-tight">{t.label}</div>
                        {t.desc && (
                          <div className="text-[11px] text-text-muted mt-1 leading-relaxed font-normal normal-case">{t.desc}</div>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Form Fields */}
              <div className="space-y-6">
                <AmountInput
                  value={formData.amount}
                  onChange={(val) => { setFieldErrors(prev => ({ ...prev, amount: false })); setFormData({ ...formData, amount: val }); }}
                  token={formData.token}
                  hasError={fieldErrors.amount}
                />
                <div className="space-y-2">
                  <label className="text-xs font-bold text-text-muted uppercase tracking-widest">Payment token</label>
                  <div className="grid grid-cols-2 gap-3">
                    {(['QIE', 'QUSDC'] as const).map((token) => {
                      const disabled = token === 'QUSDC' && !QUSDC_ADDRESS;
                      return (
                        <button
                          key={token}
                          type="button"
                          disabled={disabled}
                          onClick={() => {
                            setFormData({ ...formData, token });
                            setDefaultToken(token);
                          }}
                          className={`rounded-2xl border px-5 py-4 text-left transition-all disabled:cursor-not-allowed disabled:opacity-50 ${
                            formData.token === token
                              ? 'border-primary bg-primary/10 text-white'
                              : 'border-border-default bg-surface-2 text-text-secondary hover:border-primary/30'
                          }`}
                        >
                          <div className="text-sm font-bold">{token}</div>
                          <div className="mt-1 text-[11px] text-text-muted">
                            {token === 'QIE' ? 'Native gas token payment' : disabled ? 'Configure VITE_QUSDC_ADDRESS' : 'Stablecoin ERC-20 payment'}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
                {type === 'donation' && (
                  <p className="text-xs text-text-muted -mt-3">
                    Set amount to <code className="text-primary">0</code> to accept any contribution.
                  </p>
                )}

                <div className="space-y-2">
                  <label className="text-xs font-bold text-text-muted uppercase tracking-widest flex items-center gap-2">
                    Memo <span className="text-xs font-normal text-text-dim normal-case">shown to payer</span>
                  </label>
                  <input type="text" placeholder="What is this for?" maxLength={256} value={formData.memo}
                    onChange={(e) => setFormData({ ...formData, memo: e.target.value })}
                    className="w-full h-14 px-6 bg-surface-2 border border-border-default rounded-2xl text-white focus:border-primary/40 focus:outline-none" />
                  <p className="text-xs text-text-dim text-right">{formData.memo.length}/256</p>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-text-muted uppercase tracking-widest">Expires At</label>
                  <div className="flex items-center gap-4">
                    <div className="flex-1">
                      <DatePicker
                        value={formData.deadline}
                        onChange={(val) => setFormData({ ...formData, deadline: val })}
                        disabled={formData.noDeadline}
                        minDate={new Date(Date.now() + 86400000).toISOString().split('T')[0]}
                        placeholder="Select expiry date"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, noDeadline: !formData.noDeadline, deadline: '' })}
                      className="flex items-center gap-3 text-xs text-text-secondary cursor-pointer shrink-0"
                    >
                      <div className={`relative w-10 h-5 rounded-full transition-colors ${formData.noDeadline ? 'bg-primary' : 'bg-surface-3 border border-border-default'}`}>
                        <div className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${formData.noDeadline ? 'left-5 bg-black' : 'left-0.5 bg-text-muted'}`} />
                      </div>
                      No expiry
                    </button>
                  </div>
                </div>

              </div>

              <div className="pt-8 mt-auto">
                <Button className="w-full" onClick={() => setStep(2)}>
                  Review invoice <ArrowRight className="w-5 h-5 ml-2" />
                </Button>
              </div>
            </motion.div>
          )}

          {/* STEP 2: Review */}
          {step === 2 && (
            <motion.div key="step2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-10 flex-1">
              <div>
                <h2 className="text-2xl font-bold text-white">Review invoice</h2>
                <p className="text-sm text-text-muted mt-1">
                  Settled on-chain on QIE Mainnet (chain 1990). Non-custodial — funds go directly from payer to your wallet.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* What payer sees */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-primary">
                    <Eye className="w-4 h-4" />
                    <span className="text-xs font-bold uppercase tracking-widest">What payer sees</span>
                  </div>
                  <div className="p-5 bg-surface-2 border border-border-default rounded-2xl space-y-3">
                    <div className="text-3xl font-extrabold tracking-tight text-white">
                      {formData.amount || '0'} <span className="text-text-muted text-base font-bold">{formData.token}</span>
                    </div>
                    {formData.memo && (
                      <div className="text-sm text-text-secondary border-l-2 border-primary/40 pl-3">
                        {formData.memo}
                      </div>
                    )}
                    {!formData.noDeadline && formData.deadline && (
                      <div className="text-xs text-text-muted">
                        Expires {new Date(formData.deadline).toLocaleDateString()}
                      </div>
                    )}
                    {formData.noDeadline && <div className="text-xs text-text-muted">No expiry</div>}
                  </div>
                </div>

                {/* On-chain details */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-text-muted">
                    <Lock className="w-4 h-4" />
                    <span className="text-xs font-bold uppercase tracking-widest">On-chain (QIE Mainnet)</span>
                  </div>
                  <div className="p-5 bg-surface-2 border border-border-default rounded-2xl space-y-3">
                    <Row label="Type" value={<span className="text-xs font-bold uppercase">{type}</span>} />
                    <Row label="Network" value={<span className="text-xs font-bold text-primary uppercase">chain 1990</span>} />
                    <Row label="Status on deploy" value={<span className="text-xs font-bold text-secondary uppercase">Created</span>} />
                    <Row label="Invoice hash" value={<span className="text-xs text-text-muted italic">Generated on deploy</span>} />
                    {type === 'donation' && (
                      <Row label="Min amount" value={<span className="text-xs">None — any contribution accepted</span>} />
                    )}
                  </div>
                </div>
              </div>

              {summaryFields.length > 0 && (
                <div className="p-4 bg-surface-2/40 border border-border-default rounded-2xl">
                  <div className="text-[10px] uppercase tracking-widest text-text-muted mb-2">Summary</div>
                  <ul className="space-y-1 text-xs text-text-secondary">
                    {summaryFields.map((f, i) => <li key={i}>· {f}</li>)}
                  </ul>
                </div>
              )}

              <div className="pt-8 flex gap-4 mt-auto">
                <Button variant="outline" className="flex-1" onClick={() => setStep(1)}>
                  <ArrowLeft className="w-5 h-5 mr-2" /> Back
                </Button>
                <Button className="flex-[2]" onClick={() => setStep(3)}>
                  Continue <ArrowRight className="w-5 h-5 ml-2" />
                </Button>
              </div>
            </motion.div>
          )}

          {/* STEP 3: Deploy */}
          {step === 3 && (
            <motion.div key="step3" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-10 flex-1">
              <h2 className="text-2xl font-bold text-white">Confirm & Deploy</h2>

              {/* Summary */}
              <div className="p-6 bg-surface-2 border border-border-default rounded-3xl space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-text-secondary">Type</span>
                  <span className="text-xs font-bold text-white uppercase tracking-widest">{type}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-text-secondary">Amount</span>
                  <span className="text-lg font-bold text-white">{formData.amount || '0'} <span className="text-xs text-text-muted">{formData.token}</span></span>
                </div>
                {formData.memo && (
                  <div className="flex justify-between items-start gap-4">
                    <span className="text-sm text-text-secondary shrink-0">Memo</span>
                    <span className="text-sm text-white text-right">{formData.memo}</span>
                  </div>
                )}
                <div className="flex justify-between items-center">
                  <span className="text-sm text-text-secondary">Expires</span>
                  <span className="text-sm text-white">
                    {formData.noDeadline ? 'Never' : (formData.deadline ? new Date(formData.deadline).toLocaleDateString() : '—')}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-text-secondary">Network</span>
                  <span className="text-xs font-bold text-primary uppercase">QIE Mainnet · chain 1990</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-text-secondary">Source of truth</span>
                  <span className="text-sm text-primary">Backend API + QIE RPC verification</span>
                </div>
              </div>

              {/* Deploy Logs */}
              {deployLogs.length > 0 && (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-primary">
                    <Terminal className="w-4 h-4" />
                    <span className="text-xs font-bold uppercase tracking-widest">Deploy Log</span>
                  </div>
                  <div className="p-6 bg-black rounded-2xl border border-border-default font-mono text-xs space-y-2">
                    {deployLogs.map((log, i) => (
                      <motion.p key={i} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                        className={log.startsWith('> Invoice ready') || log.startsWith('> Confirmed') ? 'text-primary' : 'text-text-secondary'}>
                        {log}
                      </motion.p>
                    ))}
                    {isDeploying && (
                      <motion.div animate={{ opacity: [1, 0] }} transition={{ duration: 0.8, repeat: Infinity }}
                        className="inline-block w-2 h-4 bg-primary ml-1" />
                    )}
                  </div>
                </div>
              )}

              <div className="pt-4 flex gap-4 mt-auto">
                <Button variant="outline" className="flex-1" onClick={() => setStep(2)} disabled={isDeploying}>
                  <ArrowLeft className="w-5 h-5 mr-2" /> Back
                </Button>
                <Button className="flex-[2] gap-2" onClick={handleDeploy} disabled={isDeploying}>
                  {isDeploying ? <Loader2 className="w-5 h-5 animate-spin" /> : <Shield className="w-5 h-5" />}
                  {isDeploying ? 'Deploying...' : `Create ${formData.token} invoice`}
                </Button>
              </div>
            </motion.div>
          )}

          {/* STEP 4: Success */}
          {step === 4 && (
            <motion.div key="step4" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
              className="flex-1 flex flex-col items-center justify-center text-center space-y-8">
              <div className="w-24 h-24 bg-primary/10 rounded-[32px] flex items-center justify-center relative">
                <CheckCircle className="w-12 h-12 text-primary" />
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1.5, opacity: 0 }} transition={{ duration: 1 }}
                  className="absolute inset-0 bg-primary/20 rounded-full" />
              </div>
              <div className="space-y-2">
                <h2 className="text-3xl font-bold text-primary">Invoice created</h2>
                <p className="text-text-secondary">Your invoice is now live on QIE Mainnet.</p>
              </div>
              <div className="p-6 bg-surface-2 border border-border-default rounded-3xl w-full max-w-md space-y-4">
                <div className="space-y-1">
                  <p className="text-xs text-text-muted uppercase tracking-widest">Invoice Hash</p>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-mono text-white break-all">{deployedHash}</p>
                    <button onClick={() => { if (deployedHash) { navigator.clipboard.writeText(deployedHash); addToast('success', 'Hash copied'); } }}
                      className="p-2 text-text-muted hover:text-primary shrink-0"><Copy className="w-4 h-4" /></button>
                  </div>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-text-muted uppercase tracking-widest">Payment Link</p>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-mono text-text-secondary break-all">{shareWebUrl}</p>
                    <button onClick={() => { navigator.clipboard.writeText(shareWebUrl); addToast('success', 'Link copied'); }}
                      className="p-2 text-text-muted hover:text-primary shrink-0"><Copy className="w-4 h-4" /></button>
                  </div>
                </div>
                {shareQantara && (
                  <div className="space-y-1">
                    <p className="text-xs text-text-muted uppercase tracking-widest">Qantara Link (standard)</p>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-mono text-text-secondary break-all">{shareQantara}</p>
                      <button onClick={() => { navigator.clipboard.writeText(shareQantara); addToast('success', 'Qantara link copied'); }}
                        className="p-2 text-text-muted hover:text-primary shrink-0"><Copy className="w-4 h-4" /></button>
                    </div>
                  </div>
                )}
              </div>

              {/* QR Code — web URL, EIP-681 wallet deep-link, and canonical qantara:// */}
              <div className="flex flex-col items-center gap-3">
                <QRDisplay value={shareWebUrl} eip681={shareEip681} qantara={shareQantara} size={160} />
                <p className="text-xs text-text-dim">Scan to open payment page or hand off to a wallet</p>
              </div>
              <div className="flex gap-4">
                <Button variant="outline" onClick={() => navigate('/app/dashboard')} className="gap-2">
                  Go to Dashboard <ArrowRight className="w-4 h-4" />
                </Button>
                <Button onClick={resetForm}>Create Another</Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-text-secondary">{label}</span>
      <span className="text-white">{value}</span>
    </div>
  );
}
