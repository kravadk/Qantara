import { useEffect, useState, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowRight, CheckCircle, ExternalLink, Loader2, Radio, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '../Button';

export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => (
    typeof window !== 'undefined'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false
  ));

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  return reduced;
}

export function Reveal({
  children,
  className = '',
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      initial={reduced ? false : { opacity: 0 }}
      whileInView={reduced ? undefined : { opacity: 1 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.4, delay, ease: 'easeOut' }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  body,
  align = 'center',
}: {
  eyebrow: string;
  title: string;
  body: string;
  align?: 'left' | 'center';
}) {
  return (
    <Reveal className={align === 'center' ? 'mx-auto max-w-3xl text-center' : 'max-w-3xl'}>
      <div className={`mb-4 inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.24em] text-primary ${align === 'center' ? 'justify-center' : ''}`}>
        <Radio className="h-3.5 w-3.5" />
        {eyebrow}
      </div>
      <h2 className="text-3xl font-black leading-[1.03] tracking-tight text-white md:text-5xl">
        {title}
      </h2>
      <p className="mt-4 text-sm leading-6 text-text-secondary md:text-base">
        {body}
      </p>
    </Reveal>
  );
}

export function PublicCtaRow({ className = '' }: { className?: string }) {
  return (
    <div className={`flex flex-col gap-3 sm:flex-row ${className}`}>
      <Link to="/app/new-cipher">
        <Button size="lg" className="w-full sm:w-auto">
          Create invoice <ArrowRight className="h-4 w-4" />
        </Button>
      </Link>
      <Link to="/app/payment-proofs">
        <Button size="lg" variant="secondary" className="w-full sm:w-auto">
          View proof flow <ShieldCheck className="h-4 w-4" />
        </Button>
      </Link>
      <Link to="/app/checkout-api">
        <Button size="lg" variant="ghost" className="w-full sm:w-auto">
          Developer API <ExternalLink className="h-4 w-4" />
        </Button>
      </Link>
    </div>
  );
}

export function LoadingPlate({ label = 'Loading live network state' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 rounded-2xl border border-border-default bg-surface-1/70 px-4 py-3 text-xs text-text-secondary">
      <Loader2 className="h-4 w-4 animate-spin text-primary" />
      {label}
    </div>
  );
}

export function MetricPill({ label, value, ok = true }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="min-w-0 rounded-2xl border border-border-default bg-surface-1/75 p-4 backdrop-blur">
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-text-muted">
        {ok ? <CheckCircle className="h-3.5 w-3.5 text-primary" /> : <Radio className="h-3.5 w-3.5 text-yellow-300" />}
        {label}
      </div>
      <div className={`mt-2 truncate text-sm font-bold ${ok ? 'text-white' : 'text-yellow-200'}`}>{value}</div>
    </div>
  );
}

export function ProofRail({ compact = false }: { compact?: boolean }) {
  const steps = ['Create', 'Chat', 'Pay', 'Verify', 'Receipt', 'Webhook'];
  return (
    <div className={`rounded-3xl border border-border-default bg-surface-1/60 ${compact ? 'p-3' : 'p-5'}`}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {steps.map((step, index) => (
          <div
            key={step}
            className="rounded-2xl border border-border-default bg-surface-1 px-3 py-3"
          >
            <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-text-muted">0{index + 1}</div>
            <div className="mt-1 text-sm font-bold text-white">{step}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function PublicFooter() {
  return (
    <footer className="relative border-t border-border-default bg-surface-1/40">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-8 text-sm text-text-muted md:flex-row md:items-center md:justify-between">
        <span>Qantara - Non-custodial QIE payments - MIT License</span>
        <div className="flex flex-wrap gap-4">
          <Link to="/manifesto" className="hover:text-primary">Manifesto</Link>
          <Link to="/showcase" className="hover:text-primary">Product tour</Link>
          <a href="https://mainnet.qie.digital" target="_blank" rel="noreferrer" className="hover:text-primary">QIE Explorer</a>
          <a href="https://docs.qie.digital" target="_blank" rel="noreferrer" className="hover:text-primary">QIE Docs</a>
        </div>
      </div>
    </footer>
  );
}
