import {
  ArrowUpRight, BadgeCheck, Code2, Coins, Globe2, Layers, Radio, ReceiptText, Repeat,
  ShieldCheck, Split, Users, Wallet, Webhook, Workflow, Zap,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Reveal, PublicFooter } from '../components/public/PublicMotion';
import { Atmosphere, Overline, SectionHeader, BentoCard } from '../components/public/landing/parts';
import { formatPublicMetric, usePublicSignals } from '../components/public/usePublicSignals';
import { useSeo } from '../lib/useSeo';

const programmable = [
  { icon: Layers, tag: 'Escrow', title: 'Milestone escrow', body: 'Pre-funded, released in 25/50/75/100% tiers — optional arbiter, no trust gap.' },
  { icon: Repeat, tag: 'Streams', title: 'Recurring & streaming', body: 'Prefunded subscriptions and per-second streams that the merchant pulls on schedule.' },
  { icon: Split, tag: 'Splits', title: 'Split settlement', body: 'One payment, many recipients — shares enforced on-chain, dust to the last.' },
  { icon: Users, tag: 'Collective', title: 'Multi-payer invoices', body: 'Many wallets fund one invoice; settle when the goal is met, pull-refund if not.' },
  { icon: Coins, tag: 'Payouts', title: 'Batch payouts', body: 'Fund many recipients in one tx; each claims independently, plus bearer claims.' },
];

const ecosystem = [
  { name: 'QIE Wallet', body: 'Connect, switch chain, sign payment actions', href: 'https://qiewallet.me', icon: Wallet },
  { name: 'QUSDC Stable', body: 'Configured stablecoin payment + acquisition rails', href: 'https://www.stable.qie.digital/', icon: BadgeCheck },
  { name: 'QIE Explorer', body: 'Every receipt links to public on-chain proof', href: 'https://mainnet.qie.digital', icon: Globe2 },
  { name: 'QIE Docs', body: 'Network, RPC, wallet & integration references', href: 'https://docs.qie.digital', icon: Code2 },
];

export function Home() {
  useSeo({
    title: 'Qantara',
    description: 'Qantara — create and pay on-chain payment links and invoices on QIE Mainnet. Hosted checkout, deal-room chat, RPC-verified receipts, webhooks, and Telegram.',
    type: 'website',
  });

  const signals = usePublicSignals();
  const live = Boolean(signals.health?.ok);
  const rpcOk = Boolean(signals.health?.rpc?.ok);
  const block = signals.health?.rpc?.blockNumber;
  const activeRails = signals.rails?.rails.filter((r) => r.status === 'active').length;
  const network = signals.networkCatalog?.networks.find((n) => n.key === signals.networkCatalog?.activeNetwork)
    ?? signals.networkCatalog?.networks[0] ?? null;
  const ecosystemReady = signals.ecosystem?.links.filter((l) => l.availability === 'available').length;

  const statusText = signals.loading ? 'SYNCING' : live ? 'LIVE' : 'DEGRADED';
  const statusColor = signals.loading ? 'text-text-secondary' : live ? 'text-emerald-400' : 'text-amber-400';

  // Compact big-number formatter — never render long words as giant display numbers.
  const big = (n?: number | null) => (n === undefined || n === null ? '—' : formatPublicMetric(n));

  const ledger: Array<[string, string, boolean]> = [
    ['STATUS', statusText, live],
    ['BLOCK', rpcOk ? `#${block ?? '—'}` : 'unverified', rpcOk],
    ['RAILS', activeRails === undefined ? '—' : `${activeRails} active`, (activeRails ?? 0) > 0],
    ['PAID', big(signals.stats?.paidCount), signals.stats?.paidCount !== undefined],
    ['RECEIPTS', big(signals.stats?.receiptsCount), signals.stats?.receiptsCount !== undefined],
    ['NETWORK', network ? `${network.name} · ${network.rpcUrls.length} RPC` : '—', Boolean(network)],
  ];

  const stats = [
    { k: 'Paid invoices', v: big(signals.stats?.paidCount) },
    { k: 'Receipts issued', v: big(signals.stats?.receiptsCount) },
    { k: 'Active rails', v: activeRails === undefined ? '—' : String(activeRails) },
    { k: 'Ecosystem links', v: ecosystemReady === undefined ? '—' : String(ecosystemReady) },
  ];

  const ticker = [
    'QIE MAINNET', 'CHAIN 1990', rpcOk ? `BLOCK #${block ?? '—'}` : 'RPC UNVERIFIED',
    `${activeRails ?? 0} RAILS`, `${big(signals.stats?.paidCount)} PAID`,
    `${big(signals.stats?.receiptsCount)} RECEIPTS`, 'NATIVE QIE', 'QUSDC', 'GASLESS', 'PROVEN ON-CHAIN',
  ];

  return (
    <div className="relative min-h-screen overflow-hidden bg-bg-base font-body text-white">
      <Atmosphere />

      {/* ── 1 · Hero ───────────────────────────────────────────────────────── */}
      <section className="sweep-line relative flex min-h-[94vh] flex-col justify-center">
        <div aria-hidden className="ghost-word pointer-events-none absolute -bottom-[3vw] left-1/2 -translate-x-1/2 select-none whitespace-nowrap text-[26vw]">
          QANTARA
        </div>

        <div className="relative mx-auto w-full max-w-[1240px] px-5">
          <div className="ledger-scan mb-12 flex flex-wrap items-center gap-x-7 gap-y-1 border-y ln-border py-3 font-data text-[11px] uppercase tracking-[0.2em] text-text-secondary">
            <span className="inline-flex items-center gap-2 text-white">
              <span className={`h-1.5 w-1.5 rounded-full ${live ? 'bg-emerald-400 pulse-glow' : 'bg-amber-400'}`} />
              QIE Mainnet
            </span>
            <span>chain 1990</span>
            <span className="hidden sm:inline">{rpcOk ? `block #${block ?? '—'}` : 'rpc unverified'}</span>
            <span className="ml-auto hidden text-text-muted sm:inline">on-chain settlement layer</span>
          </div>

          <div className="grid items-center gap-12 lg:grid-cols-[1.08fr_0.92fr]">
            <div>
              <Reveal>
                <Overline>Invoice · Pay · Prove</Overline>
                <h1 className="mt-6 font-display text-[15vw] font-semibold leading-[0.84] tracking-[-0.02em] sm:text-7xl lg:text-[6.4rem] xl:text-[7.6rem]">
                  Get paid<br className="hidden sm:block" /> on QIE.
                  <span className="mt-2 block text-text-muted">
                    Proven, <span className="text-primary text-glow">not promised.</span>
                  </span>
                </h1>
                <p className="mt-8 max-w-xl text-base leading-7 text-text-secondary md:text-lg">
                  Qantara turns a QIE invoice into a live deal room — checkout, chat, route planning,
                  RPC verification, receipt, webhook, and Telegram, all tied to one invoice hash.
                  Paid is a backend decision against the chain, never a guess in the browser.
                </p>
              </Reveal>

              <Reveal delay={0.08}>
                <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:items-center">
                  <Link to="/app/new-cipher" className="group inline-flex items-center justify-center gap-2 bg-primary px-7 py-4 text-sm font-semibold text-white transition border-glow hover:bg-[#ff3d88]">
                    Create an invoice
                    <ArrowUpRight className="h-4 w-4 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                  </Link>
                  <Link to="/app/payment-proofs" className="inline-flex items-center justify-center gap-2 border ln-border bg-surface-1 px-7 py-4 text-sm font-semibold text-white transition hover:border-primary/60">
                    See the proof flow <ShieldCheck className="h-4 w-4" />
                  </Link>
                  <Link to="/app/checkout-api" className="px-2 py-4 text-sm font-medium text-text-secondary underline-offset-4 transition hover:text-primary hover:underline">
                    Developer API →
                  </Link>
                </div>
              </Reveal>
            </div>

            <Reveal delay={0.14}>
              <div className="relative">
                <div aria-hidden className="absolute -inset-8 rounded-[48px] bg-primary/25 blur-[64px]" />
                <div className="receipt receipt-perf relative p-7 font-data sm:p-8">
                <div className="flex items-center justify-between border-b border-dashed border-white/15 pb-4 text-[11px] uppercase tracking-[0.22em] text-text-secondary">
                  <span className="text-white">Ledger // live</span>
                  <span className={statusColor}>{statusText}</span>
                </div>
                <dl className="mt-1 divide-y divide-dashed divide-white/12">
                  {ledger.map(([k, v, ok]) => (
                    <div key={k} className="flex items-center justify-between gap-4 py-3.5 text-[15px]">
                      <dt className="text-text-secondary">{k}</dt>
                      <dd className={`tnum text-right ${ok ? 'text-white' : 'text-text-muted'}`}>{v}</dd>
                    </div>
                  ))}
                </dl>
                <div className="mt-4 flex items-center gap-2 border-t border-dashed border-white/15 pt-4 text-[11px] uppercase tracking-[0.22em] text-primary">
                  <ShieldCheck className="h-3.5 w-3.5" /> RPC-verified settlement
                </div>
                {signals.errors.length > 0 && (
                  <p className="mt-3 text-[11px] normal-case leading-5 tracking-normal text-amber-200/90">
                    Live data partially unavailable — structure shown without fabricated numbers.
                  </p>
                )}
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ── 2 · Rail ticker ────────────────────────────────────────────────── */}
      <div className="relative border-y ln-border">
        <div className="marquee-mask overflow-hidden py-3.5">
          <div className="animate-marquee flex w-max whitespace-nowrap font-data text-[11px] uppercase tracking-[0.28em] text-text-muted">
            {[...ticker, ...ticker, ...ticker, ...ticker].map((t, i) => (
              <span key={i} className="flex items-center">
                <span className={t === 'PROVEN ON-CHAIN' ? 'text-primary' : ''}>{t}</span>
                <span className="mx-6 text-text-dim">/</span>
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ── 3 · Thesis: proof, not trust ───────────────────────────────────── */}
      <section className="relative mx-auto grid max-w-[1240px] gap-14 px-5 py-28 lg:grid-cols-[1fr_1fr] lg:items-center">
        <Reveal>
          <Overline>Proof, not trust</Overline>
          <h2 className="mt-6 font-display text-4xl font-semibold leading-[1.02] tracking-tight sm:text-6xl">
            Paid is a fact the chain confirms.
          </h2>
          <p className="mt-7 max-w-xl text-base leading-7 text-text-secondary md:text-lg">
            The payment page can guide the wallet, but only backend verification against QIE RPC
            receipts, ERC-20 transfer logs, and indexed contract events can move an invoice to paid.
            No browser ever marks money received.
          </p>
        </Reveal>
        <Reveal delay={0.1}>
          <div className="tile p-7 font-data text-[15px] sm:p-8">
            <div className="mb-5 flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-text-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" /> verify(payment)
            </div>
            <ul className="space-y-3">
              {['rpc_receipt', 'token_transfer_log', 'indexed_event', 'amount_match', 'expiry_window'].map((f) => (
                <li key={f} className="flex items-center justify-between border-b border-dashed border-white/12 pb-3">
                  <span className="text-text-secondary">{f}</span>
                  <span className="text-emerald-400">verified ✓</span>
                </li>
              ))}
            </ul>
            <div className="mt-5 flex items-center justify-between text-base">
              <span className="text-text-muted">{'=> invoice.status'}</span>
              <span className="bg-primary px-3 py-1 font-semibold tracking-[0.18em] text-white">PAID</span>
            </div>
          </div>
        </Reveal>
      </section>

      {/* ── 4 · Product: invoices & checkout ───────────────────────────────── */}
      <section className="relative border-y ln-border">
        <div className="mx-auto grid max-w-[1240px] gap-14 px-5 py-28 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
          <Reveal>
            <Overline>Hosted checkout</Overline>
            <h2 className="mt-6 font-display text-4xl font-semibold leading-[1.02] tracking-tight sm:text-5xl">
              A payment link that is a <span className="text-primary">deal room.</span>
            </h2>
            <p className="mt-7 max-w-xl text-base leading-7 text-text-secondary">
              Share <span className="font-data text-text-secondary">/pay/:hash</span> by link or QR. The payer
              sees merchant, token, amount, expiry and chain status — and can chat with the merchant before and
              after paying. The backend plans the wallet route; the wallet does the rest.
            </p>
            <ul className="mt-8 space-y-3">
              {[
                [Wallet, 'Native QIE or configured QUSDC, with approve / permit / EIP-3009 routes'],
                [Radio, 'Deal-room chat pinned to the invoice via SSE'],
                [Workflow, 'Backend-planned payment routes, never client-fabricated'],
              ].map(([Icon, t], i) => (
                <li key={i} className="flex items-start gap-3 text-sm text-text-secondary">
                  <Icon className="mt-0.5 h-5 w-5 shrink-0 text-primary" /> {t as string}
                </li>
              ))}
            </ul>
          </Reveal>
          <Reveal delay={0.1}>
            <div className="tile p-7 font-data sm:p-8">
              <div className="flex items-center justify-between border-b border-dashed border-white/12 pb-4 text-[11px] uppercase tracking-[0.2em] text-text-muted">
                <span className="text-white">/pay/0x9f…2c</span>
                <span className="text-primary">awaiting payment</span>
              </div>
              <div className="space-y-3 py-5 text-[15px]">
                <div className="flex justify-between"><span className="text-text-muted">merchant</span><span>0x440D…36ca</span></div>
                <div className="flex justify-between"><span className="text-text-muted">amount</span><span className="tnum text-white">120.00 QUSDC</span></div>
                <div className="flex justify-between"><span className="text-text-muted">route</span><span>permit + pay (1 tx)</span></div>
                <div className="flex justify-between"><span className="text-text-muted">expiry</span><span className="tnum">23:41:08</span></div>
              </div>
              <div className="flex items-center justify-center gap-2 border border-primary/40 bg-primary/10 py-3 text-sm font-semibold text-primary">
                <Wallet className="h-4 w-4" /> Pay with wallet
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── 5 · Product: programmable payments (bento) ─────────────────────── */}
      <section className="relative mx-auto max-w-[1240px] px-5 py-28">
        <SectionHeader
          eyebrow="Beyond a single invoice"
          title="Programmable money on QIE,"
          accent="settled live."
          meta="5 contracts · chain 1990"
        />
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {programmable.map((p, i) => (
            <Reveal key={p.title} delay={i * 0.05}>
              <BentoCard icon={p.icon} tag={p.tag} title={p.title} body={p.body} className="h-full" />
            </Reveal>
          ))}
          <Reveal delay={programmable.length * 0.05}>
            <Link to="/app/start" className="tile group flex h-full flex-col justify-between p-6">
              <Workflow className="h-6 w-6 text-primary" />
              <div>
                <h3 className="font-display text-xl font-medium tracking-tight">Compose your flow</h3>
                <p className="mt-2 inline-flex items-center gap-1 text-sm text-text-secondary group-hover:text-primary">
                  Open the workspace <ArrowUpRight className="h-4 w-4 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </p>
              </div>
            </Link>
          </Reveal>
        </div>
      </section>

      {/* ── 6 · Product: gasless ───────────────────────────────────────────── */}
      <section className="relative border-y ln-border">
        <div className="mx-auto grid max-w-[1240px] gap-14 px-5 py-28 lg:grid-cols-[1fr_1fr] lg:items-center">
          <Reveal>
            <Overline>Gasless · ERC-2771</Overline>
            <h2 className="mt-6 font-display text-4xl font-semibold leading-[1.02] tracking-tight sm:text-5xl">
              You sign. The relayer pays the gas. <span className="text-primary">You stay the author.</span>
            </h2>
            <p className="mt-7 max-w-xl text-base leading-7 text-text-secondary">
              A forwarder-aware contract recovers the real signer from the relayed call, so a sponsored
              action is still attributed on-chain to the user — not to the relay. Proven end-to-end on
              QIE Mainnet.
            </p>
          </Reveal>
          <Reveal delay={0.1}>
            <ol className="tile divide-y divide-white/10 p-2 font-data text-[15px]">
              {[
                ['01', 'Payer signs an EIP-712 ForwardRequest', 'no gas, just a signature'],
                ['02', 'Backend /v1/relay/sponsor submits execute()', 'relayer wallet pays gas'],
                ['03', 'QantaraChat2771 recovers the signer', 'Message.from == payer ✓'],
              ].map(([n, t, s]) => (
                <li key={n} className="flex items-start gap-4 px-4 py-4">
                  <span className="text-primary/80 tnum">{n}</span>
                  <div>
                    <div className="text-white">{t}</div>
                    <div className="text-xs text-text-muted">{s}</div>
                  </div>
                </li>
              ))}
            </ol>
          </Reveal>
        </div>
      </section>

      {/* ── 7 · Developers / SDK ───────────────────────────────────────────── */}
      <section className="relative mx-auto grid max-w-[1240px] gap-14 px-5 py-28 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
        <Reveal>
          <Overline>Developers</Overline>
          <h2 className="mt-6 font-display text-4xl font-semibold leading-[1.02] tracking-tight sm:text-5xl">
            One hash. <span className="text-primary">Every surface.</span>
          </h2>
          <p className="mt-7 max-w-xl text-base leading-7 text-text-secondary">
            A portable <span className="font-data text-text-secondary">qantara://</span> link standard, an
            OpenAPI 3.1 spec, a TypeScript SDK, and dependency-free embeddable pay buttons. Wallet-agnostic,
            backend as source of truth.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/app/checkout-api" className="inline-flex items-center gap-2 border ln-border bg-bg-base px-5 py-3 text-sm font-semibold transition hover:border-primary/60">
              <Code2 className="h-4 w-4 text-primary" /> Checkout API
            </Link>
            <Link to="/app/build" className="inline-flex items-center gap-2 border ln-border bg-bg-base px-5 py-3 text-sm font-semibold transition hover:border-primary/60">
              <Zap className="h-4 w-4 text-primary" /> SDK & snippets
            </Link>
          </div>
        </Reveal>
        <Reveal delay={0.1}>
          <pre className="tile overflow-x-auto p-6 font-data text-[13px] leading-6 text-text-secondary sm:p-7">
{`import { buildQantaraLink } from '@qantara/sdk';

const link = buildQantaraLink({
  to: '0x440D…36ca',
  chain: 1990,
  token: 'QUSDC',
  amount: '120.00',
  hash: '0x9f…2c',
});
// qantara://pay?v=1&to=…&chain=1990&token=…
`}
          </pre>
        </Reveal>
      </section>

      {/* ── 8 · Security / verification foundation ─────────────────────────── */}
      <section className="relative border-y ln-border">
        <div className="mx-auto max-w-[1240px] px-5 py-28">
          <SectionHeader eyebrow="Foundation" title="Honest by construction." accent="No fake state." />
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <BentoCard icon={ShieldCheck} tag="Verify" title="RPC + indexed events" body="Receipts, token logs and contract events decide paid — with reorg-safe indexing." />
            <BentoCard icon={ReceiptText} tag="Receipts" title="Issued on proof" body="Receipts only exist after verification; optionally anchored to an on-chain registry." />
            <BentoCard icon={Webhook} tag="Delivery" title="Signed webhooks" body="HMAC-signed merchant webhooks with retries, plus SSE and Telegram from verified state." />
            <BentoCard icon={Globe2} tag="Ecosystem" title="QIE-native rails" body="Wallet, explorer, stablecoin and DEX/bridge links read from a configured registry." />
          </div>
        </div>
      </section>

      {/* ── 9 · Stats band (overflow-safe) ─────────────────────────────────── */}
      <div className="relative border-b ln-border bg-bg-base/30 backdrop-blur-md">
        <div className="mx-auto grid max-w-[1240px] grid-cols-2 lg:grid-cols-4 [&>*]:border-[rgba(214,204,233,0.14)]">
          {stats.map((s, i) => (
            <div key={s.k} className={`min-w-0 px-6 py-10 ${i % 2 === 1 ? 'border-l' : ''} ${i < 2 ? 'border-b lg:border-b-0' : ''} ${i >= 1 ? 'lg:border-l' : ''}`}>
              <div className="truncate font-display text-5xl font-semibold leading-none tracking-tight tnum lg:text-6xl">{s.v}</div>
              <div className="mt-3 font-data text-[11px] uppercase tracking-[0.2em] text-text-muted">{s.k}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── 10 · Ecosystem directory ───────────────────────────────────────── */}
      <section className="relative mx-auto max-w-[1240px] px-5 py-24">
        <SectionHeader eyebrow="Wired in" title="Built on the QIE stack." meta={ecosystemReady === undefined ? 'directory' : `${ecosystemReady} live links`} />
        <div className="grid sm:grid-cols-2">
          {ecosystem.map((item, i) => (
            <a key={item.name} href={item.href} target="_blank" rel="noreferrer"
              className="ledger-row group flex items-center gap-5 border-b ln-border px-2 py-7 sm:[&:nth-child(odd)]:border-r sm:[&:nth-child(odd)]:pr-8 sm:[&:nth-child(even)]:pl-8">
              <span className="font-data text-sm text-text-muted tnum">0{i + 1}</span>
              <item.icon className="h-6 w-6 shrink-0 text-text-secondary transition group-hover:text-primary" />
              <div className="min-w-0">
                <h3 className="font-display text-xl font-medium tracking-tight">{item.name}</h3>
                <p className="truncate text-sm text-text-secondary">{item.body}</p>
              </div>
              <ArrowUpRight className="ml-auto h-5 w-5 shrink-0 text-text-muted transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary" />
            </a>
          ))}
        </div>
      </section>

      {/* ── 11 · Final CTA + footer ────────────────────────────────────────── */}
      <section className="relative mx-auto max-w-[1240px] px-5 pb-32 pt-8">
        <div className="settlement-line mx-auto mb-14 h-px w-full" />
        <Reveal>
          <div className="text-center">
            <h2 className="mx-auto max-w-4xl font-display text-5xl font-semibold leading-[0.98] tracking-tight sm:text-7xl">
              Open the workspace.<br />
              <span className="text-text-muted">Get your first invoice paid.</span>
            </h2>
            <div className="mt-12 flex justify-center">
              <Link to="/app/start" className="group inline-flex items-center gap-2 bg-primary px-9 py-5 text-base font-semibold text-white transition border-glow hover:bg-[#ff3d88]">
                Enter Qantara
                <ArrowUpRight className="h-5 w-5 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </Link>
            </div>
          </div>
        </Reveal>
      </section>

      <PublicFooter />
    </div>
  );
}
