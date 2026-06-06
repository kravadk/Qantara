import { motion } from 'framer-motion';
import { CheckCircle, XCircle, Clock, Zap, Shield, Lock } from 'lucide-react';

export function StatusBadge({ status }: { status: 'open' | 'paused' | 'settled' | 'cancelled' | 'locked' }) {
  const styles = {
    open: 'bg-primary/10 text-primary border-primary/20',
    paused: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
    settled: 'bg-secondary/10 text-secondary border-secondary/20',
    cancelled: 'bg-red-500/10 text-red-500 border-red-500/20',
    locked: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
  };

  const icons = {
    open: <Clock className="w-3 h-3" />,
    paused: <Clock className="w-3 h-3" />,
    settled: <CheckCircle className="w-3 h-3" />,
    cancelled: <XCircle className="w-3 h-3" />,
    locked: <Lock className="w-3 h-3" />,
  };

  return (
    <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-bold uppercase tracking-wider ${styles[status]}`}>
      {icons[status]}
      {status}
    </div>
  );
}

export function TypeBadge({ type }: { type: 'standard' | 'multi-pay' | 'recurring' | 'vesting' | 'batch' }) {
  const styles = {
    standard: 'bg-surface-2 text-text-secondary border-border-default',
    'multi-pay': 'bg-purple-500/10 text-purple-500 border-purple-500/20',
    recurring: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
    vesting: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
    batch: 'bg-primary/10 text-primary border-primary/20',
  };

  const icons = {
    standard: <Zap className="w-3 h-3" />,
    'multi-pay': <Shield className="w-3 h-3" />,
    recurring: <Lock className="w-3 h-3" />,
    vesting: <Lock className="w-3 h-3" />,
    batch: <Zap className="w-3 h-3" />,
  };

  return (
    <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-bold uppercase tracking-wider ${styles[type]}`}>
      {icons[type]}
      {type.replace('-', ' ')}
    </div>
  );
}
