import { motion } from 'framer-motion';

export function LivePulse() {
  return (
    <div className="relative flex items-center justify-center w-3 h-3">
      <motion.div
        animate={{ scale: [1, 2.5, 1], opacity: [0.5, 0, 0.5] }}
        transition={{ duration: 2, repeat: Infinity, ease: 'easeOut' }}
        className="absolute inset-0 rounded-full bg-primary"
      />
      <div className="w-1.5 h-1.5 rounded-full bg-primary z-10" />
    </div>
  );
}
