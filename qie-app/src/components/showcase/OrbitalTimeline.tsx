import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { FilePlus2, Share2, MessagesSquare, Wallet, CheckCircle2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface Node {
  icon: LucideIcon;
  title: string;
  body: string;
}

const NODES: Node[] = [
  { icon: FilePlus2, title: 'Create', body: 'Pick an amount and token (QIE or QUSDC), add a title and optional expiry. One on-chain transaction mints the invoice.' },
  { icon: Share2, title: 'Share', body: 'Every invoice gets a shareable link and an EIP-681 QR. Drop it in Telegram, X, or on your site.' },
  { icon: MessagesSquare, title: 'Discuss', body: 'Payer and merchant talk in the on-chain deal room tied to the invoice. Context lives with the payment.' },
  { icon: Wallet, title: 'Pay', body: 'The payer pays from any EVM wallet. Funds settle payer → merchant directly through the contract — no custody.' },
  { icon: CheckCircle2, title: 'Reconcile', body: 'State comes from on-chain verification. Both sides get a receipt with the tx hash on QIE Explorer.' },
];

const SPIN_SECONDS = 48;

/**
 * Radial orbital timeline. Nodes orbit a pulsing core via a CSS
 * rotation; an inner counter-rotation keeps each node upright. Clicking a node
 * pauses the orbit and expands its detail card. Honors prefers-reduced-motion
 * (static ring, no spin).
 */
export function OrbitalTimeline() {
  const [active, setActive] = useState<number | null>(null);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    setReduced(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }, []);

  const paused = active !== null || reduced;
  const ringAnim = reduced ? 'none' : `orbit-spin ${SPIN_SECONDS}s linear infinite`;
  const counterAnim = reduced ? 'none' : `orbit-spin ${SPIN_SECONDS}s linear infinite reverse`;
  const playState = paused ? 'paused' : 'running';

  const detail = active !== null ? NODES[active] : null;

  return (
    <div className="flex flex-col items-center gap-8">
      <div className="relative aspect-square w-[300px] sm:w-[380px] md:w-[440px]">
        {/* Orbit guide ring */}
        <div className="absolute inset-[10%] rounded-full border border-border-default" />
        <div className="absolute inset-[10%] rounded-full border border-primary/10 blur-[1px]" />

        {/* Pulsing core */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-center">
          <div className="pulse-glow relative flex h-20 w-20 items-center justify-center rounded-full border border-primary/40 bg-surface-1">
            <span className="qie-gradient-text text-2xl font-extrabold">Q</span>
          </div>
        </div>

        {/* Rotating ring of nodes */}
        <div
          className="absolute inset-0"
          style={{ animation: ringAnim, animationPlayState: playState }}
        >
          {NODES.map((node, i) => {
            const angle = (i / NODES.length) * Math.PI * 2 - Math.PI / 2;
            const r = 40; // % of half-size
            const x = 50 + Math.cos(angle) * r;
            const y = 50 + Math.sin(angle) * r;
            const isActive = active === i;
            return (
              <div
                key={node.title}
                className="absolute"
                style={{ left: `${x}%`, top: `${y}%`, transform: 'translate(-50%, -50%)' }}
              >
                {/* Counter-rotation keeps the node upright */}
                <div style={{ animation: counterAnim, animationPlayState: playState }}>
                  <button
                    type="button"
                    onClick={() => setActive(isActive ? null : i)}
                    aria-pressed={isActive}
                    aria-label={`Step ${i + 1}: ${node.title}`}
                    className="group flex flex-col items-center gap-1.5 outline-none"
                  >
                    <span
                      className={`flex h-12 w-12 items-center justify-center rounded-2xl border transition-all ${
                        isActive
                          ? 'border-primary bg-primary/15 shadow-[0_0_24px_-4px_rgba(240,44,120,0.6)]'
                          : 'border-border-default bg-surface-1 group-hover:border-primary/50'
                      }`}
                    >
                      <node.icon className="h-5 w-5 text-primary" />
                    </span>
                    <span className="whitespace-nowrap text-[11px] font-bold uppercase tracking-wider text-text-secondary">
                      {node.title}
                    </span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Detail card */}
      <div className="min-h-[96px] w-full max-w-md">
        <AnimatePresence mode="wait">
          {detail ? (
            <motion.div
              key={detail.title}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.25 }}
              className="rounded-2xl border border-primary/30 bg-surface-1 p-5 text-center"
            >
              <div className="mb-1 flex items-center justify-center gap-2">
                <detail.icon className="h-4 w-4 text-primary" />
                <span className="font-bold text-text-primary">
                  {(active ?? 0) + 1}. {detail.title}
                </span>
              </div>
              <p className="text-sm text-text-secondary">{detail.body}</p>
            </motion.div>
          ) : (
            <motion.p
              key="hint"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-center text-sm text-text-muted"
            >
              Tap a node to see the step. The orbit pauses while you read.
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
