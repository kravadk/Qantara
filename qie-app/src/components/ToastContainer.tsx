import { motion, AnimatePresence } from 'framer-motion';
import { create } from 'zustand';
import { X, CheckCircle, AlertCircle, AlertTriangle, Info } from 'lucide-react';
import { useEffect, useState } from 'react';

interface Toast {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  message: string;
}

interface ToastState {
  toasts: Toast[];
  addToast: (type: Toast['type'], message: string) => void;
  removeToast: (id: string) => void;
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  addToast: (type, message) => {
    const id = crypto.randomUUID();
    set((state) => ({ toasts: [...state.toasts, { id, type, message }] }));
    const duration = type === 'error' ? 5000 : 3000;
    setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
    }, duration);
  },
  removeToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));

const COLORS = {
  success: { icon: <CheckCircle className="w-4 h-4" />, bar: 'bg-primary',      text: 'text-primary',      bg: 'border-primary/20' },
  error:   { icon: <AlertCircle className="w-4 h-4" />,  bar: 'bg-red-500',     text: 'text-red-400',      bg: 'border-red-500/20' },
  warning: { icon: <AlertTriangle className="w-4 h-4" />, bar: 'bg-yellow-500', text: 'text-yellow-400',   bg: 'border-yellow-500/20' },
  info:    { icon: <Info className="w-4 h-4" />,          bar: 'bg-blue-500',   text: 'text-blue-400',     bg: 'border-blue-500/20' },
};

const DURATION = { error: 5000, success: 3000, warning: 4000, info: 3500 };

function ToastItem({ id, type, message, onClose }: Toast & { onClose: (id: string) => void }) {
  const [progress, setProgress] = useState(100);
  const duration = DURATION[type];
  const c = COLORS[type];

  useEffect(() => {
    const start = Date.now();
    const tick = () => {
      const elapsed = Date.now() - start;
      const remaining = Math.max(0, 100 - (elapsed / duration) * 100);
      setProgress(remaining);
      if (remaining > 0) requestAnimationFrame(tick);
    };
    const raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [duration]);

  return (
    <motion.div
      role={type === 'error' ? 'alert' : 'status'}
      aria-live={type === 'error' ? 'assertive' : 'polite'}
      layout
      initial={{ opacity: 0, x: 48, scale: 0.92 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 48, scale: 0.88, transition: { duration: 0.18 } }}
      transition={{ type: 'spring', stiffness: 360, damping: 32 }}
      className={`relative overflow-hidden flex items-start gap-3 p-3.5 pr-10 bg-surface-1 border ${c.bg} rounded-2xl shadow-2xl shadow-black/40 min-w-[280px] max-w-[360px]`}
    >
      {/* Progress bar */}
      <div className="absolute bottom-0 left-0 h-0.5 w-full bg-surface-3">
        <motion.div
          className={`h-full ${c.bar}`}
          style={{ width: `${progress}%` }}
        />
      </div>

      <span className={`shrink-0 mt-0.5 ${c.text}`}>{c.icon}</span>
      <p className="flex-1 text-[13px] font-medium text-white leading-snug pr-1">{message}</p>
      <button
        onClick={() => onClose(id)}
        aria-label="Dismiss"
        className="absolute top-3 right-3 p-0.5 rounded-lg text-text-muted hover:text-white transition-colors"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </motion.div>
  );
}

export function ToastContainer() {
  const { toasts, removeToast } = useToastStore();

  return (
    <div
      className="fixed top-6 right-6 z-[10006] flex flex-col gap-3 pointer-events-none"
      aria-label="Notifications"
    >
      <AnimatePresence mode="sync">
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto">
            <ToastItem {...t} onClose={removeToast} />
          </div>
        ))}
      </AnimatePresence>
    </div>
  );
}
