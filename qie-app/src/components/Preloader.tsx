import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect } from 'react';

/** Brief, calm splash: logo + wordmark fade, then it gets out of the way. */
export function Preloader() {
  const [done, setDone] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDone(true), 650);
    return () => clearTimeout(t);
  }, []);

  return (
    <AnimatePresence>
      {!done && (
        <motion.div
          exit={{ opacity: 0 }}
          transition={{ duration: 0.35, ease: 'easeOut' }}
          className="fixed inset-0 z-[10010] flex flex-col items-center justify-center bg-bg-base"
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
            className="flex flex-col items-center gap-4"
          >
            <img src="/logo.png" alt="Qantara" className="h-16 w-16 rounded-2xl" />
            <span className="text-2xl font-bold tracking-tight text-white">Qantara</span>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
