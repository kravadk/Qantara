import { motion } from 'framer-motion';
import {
  Link as LinkIcon, Users, ShieldCheck, Split, Waves, Repeat,
  Send, Webhook, MessageSquare, Bot,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface Feature {
  icon: LucideIcon;
  title: string;
  body: string;
  /** Tailwind grid span classes for the bento layout (lg+). */
  span: string;
  accent?: boolean;
}

const FEATURES: Feature[] = [
  { icon: LinkIcon, title: 'Pay Links', body: 'Create a QIE or QUSDC invoice in 30s. Share a URL or EIP-681 QR — any EVM wallet can pay.', span: 'lg:col-span-2 lg:row-span-2', accent: true },
  { icon: Users, title: 'MultiPay', body: 'Goal-based, multi-contributor fundraising — like Kickstarter, settled on-chain.', span: 'lg:col-span-2' },
  { icon: ShieldCheck, title: 'Escrow', body: 'Milestone payments held by contract with an arbiter. Release on delivery.', span: '' },
  { icon: Split, title: 'Splits', body: 'Route one payment across recipients by basis points, automatically.', span: '' },
  { icon: Waves, title: 'Streams', body: 'Stream salaries or grants per-second. Withdraw anytime.', span: '' },
  { icon: Repeat, title: 'Recurring', body: 'Subscriptions & scheduled charges on a fixed cadence.', span: '' },
  { icon: Send, title: 'Batch payout', body: 'Pay hundreds of recipients in a single transaction.', span: '' },
  { icon: Webhook, title: 'Checkout API + Webhooks', body: 'Self-serve API keys, HMAC-signed webhooks, OpenAPI spec — integrate in minutes.', span: 'lg:col-span-2' },
  { icon: MessageSquare, title: 'On-chain chat', body: 'Deal-room messaging tied to each invoice. Context travels with the payment.', span: '' },
  { icon: Bot, title: 'Telegram bot', body: 'Issue invoices and get paid without leaving the chat.', span: '' },
];

/**
 * Bento-grid of Qantara capabilities (varying card sizes) with
 * glassmorphism + hover shimmer (.bento-card). Content reflects real contracts.
 */
export function BentoFeatures() {
  return (
    <div className="grid auto-rows-[minmax(140px,auto)] grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {FEATURES.map((f, i) => (
        <motion.div
          key={f.title}
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: (i % 4) * 0.06 }}
          className={`bento-card glass flex flex-col rounded-2xl border p-5 transition-colors hover:border-primary/40 ${
            f.accent ? 'border-primary/30 bg-primary/[0.04]' : 'border-border-default'
          } ${f.span}`}
        >
          <div
            className={`mb-3 flex h-10 w-10 items-center justify-center rounded-xl ${
              f.accent ? 'bg-primary/15' : 'bg-surface-2'
            }`}
          >
            <f.icon className="h-5 w-5 text-primary" />
          </div>
          <h3 className="font-bold text-text-primary">{f.title}</h3>
          <p className="mt-1.5 text-sm leading-relaxed text-text-secondary">{f.body}</p>
        </motion.div>
      ))}
    </div>
  );
}
