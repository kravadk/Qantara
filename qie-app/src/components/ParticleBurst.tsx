import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useState } from 'react';
import { cryptoRandom } from '../lib/random';

export function ParticleBurst({ x, y, onComplete }: { x: number; y: number; onComplete: () => void }) {
  const [particles, setParticles] = useState<any[]>([]);

  useEffect(() => {
    const newParticles = Array.from({ length: 16 }).map((_, i) => ({
      id: i,
      x: (cryptoRandom() - 0.5) * 100,
      y: (cryptoRandom() - 0.5) * 100,
      size: cryptoRandom() * 4 + 2,
      delay: cryptoRandom() * 0.2,
    }));
    setParticles(newParticles);
    const timer = setTimeout(onComplete, 1000);
    return () => clearTimeout(timer);
  }, [onComplete]);

  return (
    <div className="fixed inset-0 pointer-events-none z-[10005]">
      {particles.map((p) => (
        <motion.div
          key={p.id}
          initial={{ x, y, scale: 1, opacity: 1 }}
          animate={{ x: x + p.x, y: y + p.y, scale: 0, opacity: 0 }}
          transition={{ duration: 0.8, delay: p.delay, ease: 'easeOut' }}
          className="absolute rounded-full bg-primary"
          style={{ width: p.size, height: p.size }}
        />
      ))}
    </div>
  );
}
