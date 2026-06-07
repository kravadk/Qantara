import type { ComponentType, ReactNode } from 'react';
import { SettlementMesh } from './SettlementMesh';

/** Full-page cinematic atmosphere. A generative settlement-mesh canvas is the star;
 *  a faint aurora wash, grid, vignette and grain give it depth. Fixed so it lives
 *  under the whole scroll. */
export function Atmosphere() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
      {/* deep base */}
      <div className="absolute inset-0 bg-bg-base" />
      {/* subtle colour bed (dialled down — the mesh is the focal point) */}
      <div className="aurora absolute inset-[-20%] opacity-70" />
      {/* living node network */}
      <SettlementMesh />
      {/* faint structure + texture */}
      <div className="ledger-grid absolute inset-0 opacity-40" />
      <div className="grain absolute inset-0" />
      {/* vignette to keep edges deep and text readable */}
      <div className="absolute inset-0 bg-[radial-gradient(130%_90%_at_50%_0%,transparent_42%,rgba(10,7,18,0.86)_100%)]" />
    </div>
  );
}

/** Thin mono tick rulers down the left/right edges — cheap, premium decorative depth. */
export function SideRulers() {
  const ticks = Array.from({ length: 9 });
  return (
    <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 right-0 hidden xl:block">
      {(['left-6', 'right-6'] as const).map((side) => (
        <div key={side} className={`absolute ${side} top-1/2 flex -translate-y-1/2 flex-col items-center gap-6`}>
          {ticks.map((_, i) => (
            <span key={i} className={`block w-px ${i % 3 === 0 ? 'h-5 bg-primary/40' : 'h-2.5 bg-white/12'}`} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Mono uppercase eyebrow with an optional live dot. */
export function Overline({ children, live, className = '' }: { children: ReactNode; live?: 'ok' | 'warn'; className?: string }) {
  return (
    <p className={`inline-flex items-center gap-2 font-data text-[11px] uppercase tracking-[0.3em] text-primary ${className}`}>
      {live && <span className={`h-1.5 w-1.5 rounded-full ${live === 'ok' ? 'bg-emerald-400 pulse-glow' : 'bg-amber-400'}`} />}
      {children}
    </p>
  );
}

/** Section header: overline + big display heading (one accent phrase) + right meta. */
export function SectionHeader({
  eyebrow,
  title,
  accent,
  meta,
}: {
  eyebrow: string;
  title: string;
  accent?: string;
  meta?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-5 border-b ln-border pb-7">
      <div>
        <Overline>{eyebrow}</Overline>
        <h2 className="mt-4 max-w-3xl font-display text-4xl font-semibold leading-[1.02] tracking-tight sm:text-5xl">
          {title} {accent && <span className="text-primary">{accent}</span>}
        </h2>
      </div>
      {meta && <p className="font-data text-[11px] uppercase tracking-[0.2em] text-text-muted">{meta}</p>}
    </header>
  );
}

/** Solid high-contrast bento tile. */
export function BentoCard({
  icon: Icon,
  tag,
  title,
  body,
  className = '',
}: {
  icon: ComponentType<{ className?: string }>;
  tag: string;
  title: string;
  body: string;
  className?: string;
}) {
  return (
    <div className={`tile bento-card group flex flex-col p-6 ${className}`}>
      <div className="mb-5 flex items-center justify-between">
        <span className="flex h-11 w-11 items-center justify-center border border-white/12 text-primary transition group-hover:border-primary/50">
          <Icon className="h-5 w-5" />
        </span>
        <span className="font-data text-[10px] uppercase tracking-[0.2em] text-text-muted">{tag}</span>
      </div>
      <h3 className="font-display text-xl font-medium tracking-tight">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-text-secondary">{body}</p>
    </div>
  );
}
