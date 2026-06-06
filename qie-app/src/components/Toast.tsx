import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle, XCircle, Info, X } from 'lucide-react';
import { useEffect } from 'react';

export interface ToastProps {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
  onClose: (id: string) => void;
}

export function Toast({ id, type, message, onClose }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(() => onClose(id), 3000);
    return () => clearTimeout(timer);
  }, [id, onClose]);

  const icons = {
    success: <CheckCircle className="w-5 h-5 text-primary" />,
    error: <XCircle className="w-5 h-5 text-red-500" />,
    info: <Info className="w-5 h-5 text-secondary" />,
  };

  const colors = {
    success: 'border-primary/20 bg-primary/5',
    error: 'border-red-500/20 bg-red-500/5',
    info: 'border-secondary/20 bg-secondary/5',
  };

  return (
    <motion.div
      role={type === 'error' ? 'alert' : 'status'}
      aria-live={type === 'error' ? 'assertive' : 'polite'}
      initial={{ x: 100, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 100, opacity: 0 }}
      className={`flex items-center gap-4 p-4 rounded-2xl border ${colors[type]} shadow-2xl backdrop-blur-md min-w-[320px]`}
    >
      <div className="shrink-0">{icons[type]}</div>
      <p className="text-sm font-medium text-white flex-1">{message}</p>
      <button
        type="button"
        onClick={() => onClose(id)}
        aria-label="Dismiss notification"
        className="p-1 rounded-full hover:bg-surface-2 text-text-secondary transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
    </motion.div>
  );
}
