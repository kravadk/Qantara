import { motion } from 'framer-motion';
import { Lock, Eye, EyeOff, Copy, ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { Invoice, useInvoiceStore } from '../store/useInvoiceStore';
import { StatusBadge, TypeBadge } from './Badge';

export function InvoiceCard({ invoice, onClick, className }: { invoice: Invoice; onClick: () => void; className?: string }) {
  const { revealAmounts } = useInvoiceStore();
  const [isHovered, setIsHovered] = useState(false);

  return (
    <motion.div
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={onClick}
      whileHover={{ y: -6 }}
      className="bg-surface-1 border border-border-default rounded-[20px] p-6 cursor-pointer transition-all hover:border-border-active group relative overflow-hidden"
    >
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
      
      <div className="flex justify-between items-start mb-6">
        <div className="space-y-1">
          <p className="text-xs text-text-muted uppercase tracking-widest">Invoice Hash</p>
          <p className="text-sm font-mono text-text-secondary group-hover:text-white transition-colors">
            {invoice.hash.slice(0, 12)}...
          </p>
        </div>
        <StatusBadge status={invoice.status} />
      </div>

      <div className="space-y-4 mb-6">
        <div className="flex justify-between items-center">
          <span className="text-sm text-text-secondary">Amount</span>
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold text-white tracking-widest">
              {revealAmounts ? `$${invoice.amount}` : '••••••'}
            </span>
            <Lock className="w-4 h-4 text-text-muted" />
          </div>
        </div>
        <div className="h-[1px] bg-border-default w-full" />
        <div className="flex justify-between items-center">
          <span className="text-sm text-text-secondary">Type</span>
          <TypeBadge type={invoice.type} />
        </div>
        <div className="flex justify-between items-center">
          <span className="text-sm text-text-secondary">Created</span>
          <span className="text-sm text-white">{new Date(invoice.createdAt).toLocaleDateString('en-US')}</span>
        </div>
      </div>

      <div className="flex items-center justify-between pt-4 border-t border-border-default">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
          <span className="text-xs text-text-muted uppercase tracking-widest">Verified on QIE</span>
        </div>
        <button className="p-2 rounded-lg hover:bg-surface-2 text-text-secondary hover:text-white transition-colors">
          <ExternalLink className="w-4 h-4" />
        </button>
      </div>
    </motion.div>
  );
}
