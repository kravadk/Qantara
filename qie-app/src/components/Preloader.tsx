import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect } from 'react';
import { cryptoRandom } from '../lib/random';

export function Preloader() {
  const [phase, setPhase] = useState<'logo' | 'text' | 'sweep' | 'done'>('logo');
  const text = "Qantara";

  useEffect(() => {
    const t1 = setTimeout(() => setPhase('text'), 1200);
    const t2 = setTimeout(() => setPhase('sweep'), 2400);
    const t3 = setTimeout(() => setPhase('done'), 3200);

    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, []);

  return (
    <AnimatePresence>
      {phase !== 'done' && (
        <motion.div
          exit={{ opacity: 0, scale: 1.05 }}
          transition={{ duration: 0.6, ease: [0.76, 0, 0.24, 1] }}
          className="fixed inset-0 z-[10010] bg-bg-base flex flex-col items-center justify-center"
        >
          {/* Logo animation */}
          <motion.div
            initial={{ scale: 0, rotate: -180, opacity: 0 }}
            animate={{ scale: 1, rotate: 0, opacity: 1 }}
            transition={{ duration: 0.8, ease: [0.34, 1.56, 0.64, 1] }}
            className="mb-8"
          >
            <motion.div
              animate={phase === 'sweep' ? { scale: [1, 1.1, 1], rotate: [0, 5, 0] } : {}}
              transition={{ duration: 0.4 }}
            >
              <img src="/logo.png" alt="Qantara" className="w-20 h-20 md:w-24 md:h-24 rounded-2xl" />
            </motion.div>

            {/* Glow ring */}
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: [0.8, 1.3, 1.3], opacity: [0, 0.4, 0] }}
              transition={{ duration: 1.5, delay: 0.3, ease: 'easeOut' }}
              className="absolute inset-0 -m-4 rounded-3xl border-2 border-primary pointer-events-none"
            />
          </motion.div>

          {/* Text animation */}
          <div className="relative overflow-hidden">
            <div className="flex gap-0.5">
              {text.split('').map((char, i) => (
                <motion.span
                  key={i}
                  initial={{ opacity: 0, y: 30, rotateX: -90 }}
                  animate={phase !== 'logo' ? { opacity: 1, y: 0, rotateX: 0 } : {}}
                  transition={{ delay: i * 0.06, duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
                  className="text-3xl md:text-5xl font-bold text-white tracking-tight inline-block"
                  style={{ transformOrigin: 'bottom' }}
                >
                  {char}
                </motion.span>
              ))}
            </div>

            {/* Sweep line */}
            <motion.div
              initial={{ scaleX: 0 }}
              animate={phase === 'sweep' || phase === 'text' ? { scaleX: [0, 1] } : {}}
              transition={{ duration: 0.8, delay: 0.3, ease: [0.76, 0, 0.24, 1] }}
              className="h-0.5 bg-gradient-to-r from-transparent via-primary to-transparent mt-3 origin-left"
            />
          </div>

          {/* Subtitle */}
          <motion.p
            initial={{ opacity: 0 }}
            animate={phase === 'sweep' ? { opacity: 1 } : {}}
            transition={{ delay: 0.2, duration: 0.5 }}
            className="mt-4 text-sm text-text-muted uppercase tracking-[0.3em]"
          >
            Private Payments on QIE
          </motion.p>

          {/* Encryption particles */}
          {phase !== 'logo' && (
            <>
              {[...Array(8)].map((_, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, scale: 0 }}
                  animate={{
                    opacity: [0, 0.6, 0],
                    scale: [0, 1, 0.5],
                    x: [0, (cryptoRandom() - 0.5) * 200],
                    y: [0, (cryptoRandom() - 0.5) * 200],
                  }}
                  transition={{ duration: 1.5, delay: 0.5 + i * 0.1, ease: 'easeOut' }}
                  className="absolute w-1 h-1 bg-primary rounded-full"
                />
              ))}
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
