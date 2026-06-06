import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion, useScroll, useTransform } from 'framer-motion';
import { ArrowRight, BadgeCheck, Bot, CheckCircle2, Code2, FileCheck2, Globe2, MessageSquareText, Radio, ReceiptText, Route, Send, ShieldCheck, Wallet, Webhook, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '../components/Button';
import { HexGrid } from '../components/HexGrid';
import { ProofRail, PublicCtaRow, PublicFooter, Reveal, SectionHeading } from '../components/public/PublicMotion';
import { usePublicSignals } from '../components/public/usePublicSignals';

const chapters = [
  { key: 'checkout', icon: Wallet, title: 'Checkout', body: 'The payer sees amount, token, merchant trust, network health, QR, and backend-planned route options.' },
  { key: 'deal-room', icon: MessageSquareText, title: 'Deal Room', body: 'Payer and merchant can ask questions without moving context away from the invoice.' },
  { key: 'verification', icon: ShieldCheck, title: 'Verification', body: 'Paid state appears only after QIE RPC, contract events, or token transfer logs match the invoice.' },
  { key: 'receipts', icon: ReceiptText, title: 'Receipts', body: 'Receipts are issued from verified payment state and carry transaction, payer, merchant, token, and receipt hash.' },
  { key: 'webhooks', icon: Webhook, title: 'Webhooks', body: 'Merchant systems receive signed events with retry logs and delivery proof.' },
  { key: 'telegram', icon: Bot, title: 'Telegram', body: 'Merchant notifications and replies can loop back into the same invoice chat.' },
];

const terminalFrames = [
  ['GET /v1/payment-routes/0x4f9a', 'recommended: QUSDC approve+pay, status: ready'],
  ['POST /v1/invoices/0x4f9a/messages', 'message.created streamed to payer and merchant'],
  ['POST /v1/invoices/0x4f9a/verify-payment', 'QIE RPC receipt matched payment event'],
  ['GET /v1/receipts/0x4f9a', 'receipt hash issued from verified settlement'],
];

function TerminalTour() {
  const [active, setActive] = useState(0);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced) return;
    const id = setInterval(() => setActive((current) => (current + 1) % terminalFrames.length), 2300);
    return () => clearInterval(id);
  }, [reduced]);

  return (
    <div className="overflow-hidden rounded-[2rem] border border-border-default bg-[#090611] shadow-[0_30px_120px_-48px_rgba(240,44,120,0.75)]">
      <div className="flex items-center gap-2 border-b border-border-default bg-surface-1/60 px-4 py-3">
        <span className="h-3 w-3 rounded-full bg-red-500/70" />
        <span className="h-3 w-3 rounded-full bg-yellow-500/70" />
        <span className="h-3 w-3 rounded-full bg-primary/70" />
        <span className="ml-3 font-mono text-xs text-text-muted">qantara live lifecycle</span>
      </div>
      <div className="space-y-3 p-5 font-mono text-xs md:text-sm">
        {terminalFrames.map(([cmd, out], index) => {
          const current = index === active;
          return (
            <motion.div
              key={cmd}
              animate={{ opacity: current ? 1 : 0.35 }}
              className="rounded-xl border border-border-default bg-surface-1/45 p-3"
            >
              <div className="flex gap-2 text-text-secondary">
                <span className="text-primary">$</span>
                <span>{cmd}</span>
              </div>
              <div className="mt-2 rounded-lg bg-bg-base/70 px-3 py-2 text-text-muted">
                {out}
                {current && !reduced && (
                  <motion.span animate={{ opacity: [1, 0] }} transition={{ duration: 0.6, repeat: Infinity }} className="ml-1 text-primary">
                    |
                  </motion.span>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

function OrbitalProductTour() {
  const [active, setActive] = useState(0);
  const reduced = useReducedMotion();
  const ringStyle = reduced ? undefined : { animation: 'orbit-spin 52s linear infinite' };
  const counterStyle = reduced ? undefined : { animation: 'orbit-spin 52s linear infinite reverse' };
  const activeChapter = chapters[active];

  return (
    <div className="grid items-center gap-10 lg:grid-cols-[1fr_0.85fr]">
      <div className="relative mx-auto aspect-square w-full max-w-[520px]">
        <div className="absolute inset-[12%] rounded-full border border-border-default" />
        <div className="absolute inset-[22%] rounded-full border border-primary/15" />
        <div className="absolute left-1/2 top-1/2 flex h-28 w-28 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-primary/35 bg-primary/10 text-4xl font-black text-primary shadow-[0_0_90px_-22px_rgba(240,44,120,0.9)]">
          Q
        </div>
        <div className="absolute inset-0" style={ringStyle}>
          {chapters.map((chapter, index) => {
            const angle = (index / chapters.length) * Math.PI * 2 - Math.PI / 2;
            const x = 50 + Math.cos(angle) * 41;
            const y = 50 + Math.sin(angle) * 41;
            const isActive = active === index;
            return (
              <div key={chapter.key} className="absolute" style={{ left: `${x}%`, top: `${y}%`, transform: 'translate(-50%, -50%)' }}>
                <div style={counterStyle}>
                  <button
                    type="button"
                    onClick={() => setActive(index)}
                    className={`group flex flex-col items-center gap-2 rounded-3xl border p-3 transition ${isActive ? 'border-primary bg-primary/15' : 'border-border-default bg-surface-1 hover:border-primary/40'}`}
                  >
                    <chapter.icon className="h-5 w-5 text-primary" />
                    <span className="whitespace-nowrap text-[10px] font-bold uppercase tracking-[0.18em] text-text-secondary">{chapter.title}</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="min-h-[250px]">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeChapter.key}
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -18 }}
            className="rounded-[2rem] border border-primary/25 bg-primary/[0.055] p-7"
          >
            <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/25 bg-primary/10">
              <activeChapter.icon className="h-6 w-6 text-primary" />
            </div>
            <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-primary">Chapter {active + 1}</div>
            <h3 className="mt-3 text-3xl font-black tracking-tight text-white">{activeChapter.title}</h3>
            <p className="mt-4 leading-7 text-text-secondary">{activeChapter.body}</p>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

export function Showcase() {
  const { scrollYProgress } = useScroll();
  const y = useTransform(scrollYProgress, [0, 1], [0, -220]);
  const signals = usePublicSignals();

  return (
    <div className="relative min-h-screen overflow-hidden bg-bg-base text-white">
      <div className="qie-mesh-bg pointer-events-none absolute inset-0 opacity-70" />
      <HexGrid />
      <motion.div style={{ y }} className="pointer-events-none absolute right-[8%] top-32 h-[520px] w-[520px] rounded-full bg-primary/10 blur-[150px]" />

      <section className="relative mx-auto flex min-h-[92vh] max-w-7xl flex-col justify-center px-4 py-24">
        <Reveal className="max-w-5xl">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.24em] text-primary">
            <Radio className="h-3.5 w-3.5" />
            Visual product tour
          </div>
          <h1 className="text-5xl font-black leading-[0.98] tracking-tight text-white md:text-7xl xl:text-8xl">
            The payment room behind every Qantara link.
          </h1>
          <p className="mt-6 max-w-3xl text-base leading-7 text-text-secondary md:text-lg">
            Follow one invoice through checkout, chat, RPC verification, receipt creation, webhook delivery, and Telegram operations.
          </p>
          <PublicCtaRow className="mt-8" />
        </Reveal>
        <div className="mt-14">
          <ProofRail />
        </div>
      </section>

      <section className="relative mx-auto max-w-7xl px-4 py-24">
        <SectionHeading
          eyebrow="Operational loop"
          title="Every screen explains where state comes from."
          body="The tour is visual, but the product claim is practical: Qantara keeps all lifecycle evidence around the invoice hash."
        />
        <div className="mt-14">
          <OrbitalProductTour />
        </div>
      </section>

      <section className="relative mx-auto grid max-w-7xl gap-8 px-4 py-24 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
        <SectionHeading
          align="left"
          eyebrow="Backend planned"
          title="Checkout actions come from route planner state."
          body="The payment page asks the backend which routes are available, which are blocked, and why. If a rail is not configured, Qantara shows that state instead of inventing a path."
        />
        <TerminalTour />
      </section>

      <section className="relative mx-auto max-w-7xl px-4 py-24">
        <SectionHeading
          eyebrow="Screen chapters"
          title="A checkout that feels alive because it is connected."
          body="Public pages do not fake invoice history. They can show backend availability and explain the real flow, while the app surfaces the live records after sign-in."
        />
        <div className="mt-12 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {chapters.map((chapter, index) => (
            <Reveal key={chapter.key} delay={index * 0.04}>
              <div className="h-full rounded-[2rem] border border-border-default bg-surface-1/75 p-6 backdrop-blur transition hover:border-primary/35">
                <div className="mb-5 flex items-center justify-between">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-primary/25 bg-primary/10">
                    <chapter.icon className="h-5 w-5 text-primary" />
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-text-muted">0{index + 1}</span>
                </div>
                <h3 className="text-xl font-bold text-white">{chapter.title}</h3>
                <p className="mt-3 text-sm leading-6 text-text-secondary">{chapter.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="relative mx-auto max-w-7xl px-4 py-24">
        <div className="grid gap-4 md:grid-cols-4">
          <StatusTile icon={Route} label="Rails" value={signals.rails ? `${signals.rails.rails.length} configured` : 'Unavailable'} ok={Boolean(signals.rails)} />
          <StatusTile icon={Globe2} label="Network" value={signals.networkCatalog?.activeNetwork ?? 'Unavailable'} ok={Boolean(signals.networkCatalog)} />
          <StatusTile icon={FileCheck2} label="Receipts" value={signals.stats?.receiptsCount !== undefined ? String(signals.stats.receiptsCount) : 'Unavailable'} ok={signals.stats?.receiptsCount !== undefined} />
          <StatusTile icon={Send} label="Data mode" value={signals.degraded ? 'Degraded' : 'Live'} ok={!signals.degraded} />
        </div>
      </section>

      <section className="relative mx-auto max-w-5xl px-4 py-24 text-center">
        <Reveal>
          <CheckCircle2 className="mx-auto mb-5 h-10 w-10 text-primary" />
          <h2 className="text-4xl font-black tracking-tight text-white md:text-6xl">
            Build the payment flow around proof.
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-text-secondary">
            Qantara is designed for merchants who need payment links, status, receipts, and operational delivery in one place.
          </p>
          <div className="mt-8">
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

function StatusTile({
  icon: Icon,
  label,
  value,
  ok,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  ok: boolean;
}) {
  return (
    <div className="rounded-3xl border border-border-default bg-surface-1/75 p-5 backdrop-blur">
      <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl border border-primary/25 bg-primary/10">
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-text-muted">{label}</div>
      <div className={ok ? 'mt-2 font-bold text-white' : 'mt-2 font-bold text-yellow-200'}>{value}</div>
    </div>
  );
}
