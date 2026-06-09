import { motion } from 'framer-motion';
import { ArrowRight, BadgeCheck, CheckCircle2, Database, ExternalLink, FileCheck2, Globe2, LockKeyhole, Radio, ReceiptText, Route, ShieldCheck, Wallet, Webhook } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '../components/Button';
import { MetricPill, ProofRail, PublicCtaRow, PublicFooter, Reveal, SectionHeading } from '../components/public/PublicMotion';
import { formatPublicMetric, usePublicSignals } from '../components/public/usePublicSignals';
import { Atmosphere } from '../components/public/landing/parts';

const principles = [
  {
    icon: ShieldCheck,
    title: 'No browser-settled paid state',
    body: 'The frontend can submit wallet actions and display progress, but settlement status is accepted only after backend verification.',
  },
  {
    icon: Database,
    title: 'Backend as operational index',
    body: 'SQLite stores invoices, messages, events, receipts, webhook deliveries, alerts, and notification state around the invoice hash.',
  },
  {
    icon: Globe2,
    title: 'QIE RPC as payment proof',
    body: 'Native QIE transfers, contract events, and QUSDC token logs are matched against the invoice before receipts are issued.',
  },
];

const proofSteps = [
  ['Create tx', 'Wallet or integration creates the invoice and backend records the hash.'],
  ['Indexed event', 'The chain indexer persists contract events with block and log identity.'],
  ['Payment tx', 'Payer submits QIE or configured QUSDC payment from their wallet.'],
  ['RPC verify', 'Backend verifies receipt, value, token, payer, merchant, and invoice.'],
  ['Receipt hash', 'Receipt is issued only after the verified payment state exists.'],
  ['Delivery proof', 'Webhook and Telegram deliveries are recorded with retry state.'],
];

const ecosystem = [
  { icon: Wallet, name: 'Wallet', body: 'Connect, switch to QIE Mainnet, and sign invoice/payment actions.' },
  { icon: Globe2, name: 'Explorer', body: 'Addresses, transactions, and contract events link to public proof.' },
  { icon: BadgeCheck, name: 'QUSDC', body: 'Configured stablecoin payment and vault acquisition routes.' },
  { icon: Route, name: 'DEX / Bridge', body: 'External acquisition rails with availability state, not fabricated execution.' },
  { icon: LockKeyhole, name: 'Domains / Pass', body: 'Merchant trust surfaces are shown only when configured or verified.' },
  { icon: Webhook, name: 'Webhooks', body: 'Signed delivery records make merchant operations observable.' },
];

export function Manifesto() {
  const signals = usePublicSignals();
  const activeRails = signals.rails?.rails.filter((rail) => rail.status === 'active').length;

  return (
    <div className="relative min-h-screen overflow-hidden bg-bg-base font-body text-white">
      <Atmosphere />

      <section className="relative mx-auto max-w-7xl px-4 py-24 md:py-32">
        <Reveal className="max-w-5xl">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.24em] text-primary">
            <Radio className="h-3.5 w-3.5" />
            Qantara trust model
          </div>
          <h1 className="font-display text-5xl font-black leading-[0.98] tracking-tight text-white text-glow md:text-7xl xl:text-8xl">
            Payment software should not invent payment truth.
          </h1>
          <p className="mt-7 max-w-3xl text-base leading-7 text-text-secondary md:text-lg">
            Qantara is built around a simple rule: product UI can guide a payment, but only backend/RPC evidence can change the business state.
          </p>
          <PublicCtaRow className="mt-8" />
        </Reveal>

        <div className="mt-14 grid gap-3 md:grid-cols-4">
          <MetricPill label="Backend" value={signals.health?.ok ? 'Live' : signals.loading ? 'Checking' : 'Degraded'} ok={Boolean(signals.health?.ok)} />
          <MetricPill label="QIE RPC" value={signals.health?.rpc?.ok ? `Block ${signals.health.rpc.blockNumber ?? 'ready'}` : 'Unavailable'} ok={Boolean(signals.health?.rpc?.ok)} />
          <MetricPill label="Active rails" value={activeRails === undefined ? 'Unavailable' : String(activeRails)} ok={(activeRails ?? 0) > 0} />
          <MetricPill label="Receipts" value={formatPublicMetric(signals.stats?.receiptsCount)} ok={signals.stats?.receiptsCount !== undefined} />
        </div>
      </section>

      <section className="relative mx-auto max-w-7xl px-4 py-24">
        <SectionHeading
          eyebrow="Operating principles"
          title="Three boundaries keep the product honest."
          body="The public pages explain the model. The app enforces it through backend APIs, wallet signatures, RPC reads, and persisted operational records."
        />
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {principles.map((principle, index) => (
            <Reveal key={principle.title} delay={index * 0.06}>
              <div className="h-full rounded-[2rem] border border-border-default bg-surface-1/75 p-7 backdrop-blur">
                <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/25 bg-primary/10">
                  <principle.icon className="h-6 w-6 text-primary" />
                </div>
                <h3 className="text-xl font-bold text-white">{principle.title}</h3>
                <p className="mt-3 text-sm leading-6 text-text-secondary">{principle.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="relative mx-auto grid max-w-7xl gap-10 px-4 py-24 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
        <SectionHeading
          align="left"
          eyebrow="Proof chain"
          title="Every important state transition leaves evidence."
          body="A merchant should be able to explain where the invoice came from, who paid, what transaction matched, when the receipt was issued, and whether operations systems were notified."
        />
        <Reveal>
          <div className="space-y-4">
            <ProofRail compact />
            <div className="grid gap-3 md:grid-cols-2">
              {proofSteps.map(([title, body], index) => (
                <motion.div
                  key={title}
                  initial={{ opacity: 0, y: 12 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.04 }}
                  className="rounded-2xl border border-border-default bg-surface-1/75 p-4"
                >
                  <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-primary">0{index + 1}</div>
                  <div className="mt-2 font-bold text-white">{title}</div>
                  <p className="mt-1 text-sm leading-6 text-text-secondary">{body}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </Reveal>
      </section>

      <section className="relative mx-auto max-w-7xl px-4 py-24">
        <SectionHeading
          eyebrow="QIE ecosystem"
          title="Native rails are useful only when their status is explicit."
          body="Qantara presents configured QIE integrations with availability state. Missing config is shown as missing config, not as a simulated integration."
        />
        <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {ecosystem.map((item, index) => (
            <Reveal key={item.name} delay={index * 0.04}>
              <div className="h-full rounded-[2rem] border border-border-default bg-surface-1/75 p-6 backdrop-blur transition hover:border-primary/35">
                <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl border border-primary/25 bg-primary/10">
                  <item.icon className="h-5 w-5 text-primary" />
                </div>
                <h3 className="font-bold text-white">{item.name}</h3>
                <p className="mt-2 text-sm leading-6 text-text-secondary">{item.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="relative mx-auto max-w-5xl px-4 py-24 text-center">
        <Reveal>
          <FileCheck2 className="mx-auto mb-5 h-10 w-10 text-primary" />
          <h2 className="font-display text-4xl font-black tracking-tight text-white text-glow md:text-6xl">
            A better checkout is an audit trail users can understand.
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-text-secondary">
            Qantara makes QIE payments approachable without weakening the source of truth.
          </p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Link to="/app/start">
              <Button size="lg">
                Open workspace <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <a href="https://docs.qie.digital" target="_blank" rel="noreferrer">
              <Button size="lg" variant="secondary">
                QIE Docs <ExternalLink className="h-4 w-4" />
              </Button>
            </a>
          </div>
        </Reveal>
      </section>
      <PublicFooter />
    </div>
  );
}
