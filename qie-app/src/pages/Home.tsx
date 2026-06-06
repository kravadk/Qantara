import { lazy, Suspense } from 'react';
import { ArrowRight, BadgeCheck, Code2, ExternalLink, Globe2, LockKeyhole, Radio, ReceiptText, ShieldCheck, Sparkles, Wallet, Webhook } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '../components/Button';
import { HexGrid } from '../components/HexGrid';
import { PublicCtaRow, LoadingPlate, MetricPill, ProofRail, PublicFooter, Reveal, SectionHeading, usePrefersReducedMotion } from '../components/public/PublicMotion';
import { PaymentNetworkFallback } from '../components/public/PaymentNetworkFallback';
import { formatPublicMetric, usePublicSignals } from '../components/public/usePublicSignals';
import { useSeo } from '../lib/useSeo';

const PaymentNetworkCore = lazy(() =>
  import('../components/public/PaymentNetworkCore').then(({ PaymentNetworkCore }) => ({ default: PaymentNetworkCore })),
);

const routeSteps = [
  { icon: ReceiptText, label: 'Create', body: 'Merchant creates a wallet-backed invoice record.' },
  { icon: Radio, label: 'Chat', body: 'Payer questions stay attached to the invoice.' },
  { icon: Wallet, label: 'Pay', body: 'Wallet submits QIE or configured QUSDC payment.' },
  { icon: ShieldCheck, label: 'Verify', body: 'Backend checks QIE RPC and indexed events.' },
  { icon: Webhook, label: 'Notify', body: 'Receipt, webhook, SSE, and Telegram update.' },
];

const stackLinks = [
  { name: 'QIE Wallet', body: 'Connect, switch chain, and sign payment actions.', href: 'https://qiewallet.me', icon: Wallet },
  { name: 'QUSDC Stable', body: 'Configured stablecoin payment and acquisition rails.', href: 'https://www.stable.qie.digital/', icon: BadgeCheck },
  { name: 'QIE Explorer', body: 'Receipts and payment transactions link to public proof.', href: 'https://mainnet.qie.digital', icon: Globe2 },
  { name: 'QIE Docs', body: 'Network, RPC, wallet, and integration references.', href: 'https://docs.qie.digital', icon: Code2 },
];

export function Home() {
  useSeo({
    title: 'Qantara',
    description: 'Qantara — create and pay on-chain payment links and invoices on QIE Mainnet. Hosted checkout, deal-room chat, RPC-verified receipts, webhooks, and Telegram.',
    type: 'website',
  });
  const reducedMotion = usePrefersReducedMotion();
  const signals = usePublicSignals();
  const activeRails = signals.rails?.rails.filter((rail) => rail.status === 'active').length;
  const activeNetwork = signals.networkCatalog?.networks.find((network) => network.key === signals.networkCatalog?.activeNetwork)
    ?? signals.networkCatalog?.networks[0]
    ?? null;
  const ecosystemReady = signals.ecosystem?.links.filter((link) => link.availability === 'available').length;

  return (
    <div className="relative min-h-screen overflow-hidden bg-bg-base text-white">
      <div className="qie-mesh-bg pointer-events-none absolute inset-0 opacity-80" />
      <HexGrid />

      <section className="relative mx-auto grid min-h-[calc(100vh-72px)] max-w-7xl items-center gap-10 px-4 pb-16 pt-24 lg:grid-cols-[0.92fr_1.08fr] lg:pt-20">
        <Reveal className="relative z-10">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.24em] text-primary">
            <Sparkles className="h-3.5 w-3.5" />
            QIE-native payment workspace
          </div>
          <h1 className="max-w-4xl text-5xl font-black leading-[0.97] tracking-tight text-white md:text-7xl xl:text-8xl">
            Payment links with a verifiable rail.
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-7 text-text-secondary md:text-lg">
            Qantara turns a QIE invoice into a live deal room: checkout, chat, route planning, RPC verification,
            receipt, webhook, and Telegram updates all stay tied to one invoice hash.
          </p>
          <PublicCtaRow className="mt-8" />

          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            <MetricPill label="Backend" value={signals.loading ? 'Checking' : signals.health?.ok ? 'Live' : 'Degraded'} ok={Boolean(signals.health?.ok)} />
            <MetricPill label="QIE RPC" value={signals.health?.rpc?.ok ? `Block ${signals.health.rpc.blockNumber ?? 'ready'}` : 'Not verified'} ok={Boolean(signals.health?.rpc?.ok)} />
            <MetricPill label="Rails" value={activeRails === undefined ? 'Unavailable' : `${activeRails} active`} ok={(activeRails ?? 0) > 0} />
          </div>
        </Reveal>

        <Reveal delay={0.12} className="relative z-10">
          {reducedMotion ? (
            <PaymentNetworkFallback />
          ) : (
            <Suspense fallback={<PaymentNetworkFallback />}>
              <PaymentNetworkCore />
            </Suspense>
          )}
        </Reveal>
      </section>

      <section className="relative mx-auto max-w-7xl px-4 py-10">
        {signals.loading ? (
          <LoadingPlate />
        ) : (
          <div className="grid gap-3 md:grid-cols-4">
            <MetricPill label="Network catalog" value={activeNetwork ? `${activeNetwork.name} (${activeNetwork.rpcUrls.length} RPCs)` : 'Unavailable'} ok={Boolean(activeNetwork)} />
            <MetricPill label="Ecosystem links" value={ecosystemReady === undefined ? 'Unavailable' : `${ecosystemReady} available`} ok={(ecosystemReady ?? 0) > 0} />
            <MetricPill label="Paid invoices" value={formatPublicMetric(signals.stats?.paidCount)} ok={signals.stats?.paidCount !== undefined} />
            <MetricPill label="Receipts" value={formatPublicMetric(signals.stats?.receiptsCount)} ok={signals.stats?.receiptsCount !== undefined} />
          </div>
        )}
        {signals.errors.length > 0 && (
          <div className="mt-3 rounded-2xl border border-yellow-400/20 bg-yellow-400/8 px-4 py-3 text-xs text-yellow-100">
            Public live data is partially unavailable. Qantara is showing product structure without fabricated network numbers.
          </div>
        )}
      </section>

      <section className="relative mx-auto max-w-7xl px-4 py-24">
        <SectionHeading
          eyebrow="Live payment rail"
          title="Create, discuss, pay, verify, and reconcile without losing context."
          body="The core product is not a static checkout page. It is an operational loop for merchant and payer actions around the same invoice hash."
        />
        <div className="mt-12 grid gap-3 lg:grid-cols-5">
          {routeSteps.map((step, index) => (
            <Reveal key={step.label} delay={index * 0.04}>
              <div className="h-full rounded-3xl border border-border-default bg-surface-1/75 p-5 backdrop-blur transition-colors hover:border-primary/35">
                <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl border border-primary/25 bg-primary/10">
                  <step.icon className="h-5 w-5 text-primary" />
                </div>
                <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-text-muted">0{index + 1}</div>
                <h3 className="mt-2 text-lg font-bold text-white">{step.label}</h3>
                <p className="mt-2 text-sm leading-6 text-text-secondary">{step.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="relative mx-auto grid max-w-7xl gap-8 px-4 py-24 lg:grid-cols-[0.85fr_1.15fr] lg:items-center">
        <SectionHeading
          align="left"
          eyebrow="Proof, not trust"
          title="Paid state is a backend/RPC decision, never a browser guess."
          body="The payment page can guide the wallet, but only backend verification against QIE RPC, token logs, and indexed contract events can settle the invoice lifecycle."
        />
        <Reveal>
          <ProofRail />
        </Reveal>
      </section>

      <section className="relative mx-auto max-w-7xl px-4 py-24">
        <SectionHeading
          eyebrow="QIE ecosystem"
          title="A checkout surface wired to the chain, wallet, explorer, and stablecoin rails."
          body="Qantara reads the configured QIE ecosystem registry from the backend and degrades cleanly when a public integration is not configured."
        />
        <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {stackLinks.map((item) => (
            <a
              key={item.name}
              href={item.href}
              target="_blank"
              rel="noreferrer"
              className="group rounded-3xl border border-border-default bg-surface-1/75 p-6 backdrop-blur transition hover:border-primary/40"
            >
              <div className="mb-5 flex items-center justify-between">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-primary/25 bg-primary/10">
                  <item.icon className="h-5 w-5 text-primary" />
                </div>
                <ExternalLink className="h-4 w-4 text-text-muted transition group-hover:text-primary" />
              </div>
              <h3 className="font-bold text-white">{item.name}</h3>
              <p className="mt-2 text-sm leading-6 text-text-secondary">{item.body}</p>
            </a>
          ))}
        </div>
      </section>

      <section className="relative mx-auto max-w-5xl px-4 py-24 text-center">
        <Reveal>
          <LockKeyhole className="mx-auto mb-5 h-9 w-9 text-primary" />
          <h2 className="text-4xl font-black leading-tight tracking-tight text-white md:text-6xl">
            Ship a payment link that behaves like infrastructure.
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-text-secondary">
            Start with one invoice. Add chat, receipts, route planning, webhooks, and Telegram as the payment becomes operational.
          </p>
          <div className="mt-8 flex justify-center">
            <Link to="/app/start">
              <Button size="lg">
                Open workspace <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        </Reveal>
      </section>

      <PublicFooter />
    </div>
  );
}
