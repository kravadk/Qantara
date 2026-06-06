import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';
import { useRef, useState } from 'react';
import { QrCode, Shield, Copy } from 'lucide-react';

export function CipherCard({ address, onQrClick }: { address: string; onQrClick?: () => void }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [isHovered, setIsHovered] = useState(false);

  const x = useMotionValue(0);
  const y = useMotionValue(0);

  const rotateX = useSpring(useTransform(y, [-100, 100], [15, -15]), { damping: 20, stiffness: 200 });
  const rotateY = useSpring(useTransform(x, [-150, 150], [-15, 15]), { damping: 20, stiffness: 200 });

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    x.set(e.clientX - centerX);
    y.set(e.clientY - centerY);
  };

  const handleMouseLeave = () => {
    x.set(0);
    y.set(0);
    setIsHovered(false);
  };

  return (
    <motion.div
      ref={cardRef}
      data-cipher-card
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={handleMouseLeave}
      style={{ rotateX, rotateY, perspective: 1000 }}
      className="relative w-full max-w-[340px] h-[200px] rounded-[24px] bg-surface-1 border border-border-default overflow-hidden group cursor-pointer"
    >
      <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-secondary/10 opacity-30" />
      
      {/* Holographic Shimmer */}
      <motion.div
        style={{
          background: 'radial-gradient(circle at var(--x) var(--y), rgba(240,44,120,0.15) 0%, rgba(126,34,206,0.15) 50%, transparent 100%)',
          '--x': useTransform(x, [-150, 150], ['0%', '100%']),
          '--y': useTransform(y, [-100, 100], ['0%', '100%']),
        } as any}
        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
      />

      <div className="relative h-full p-6 flex flex-col justify-between">
        <div className="flex justify-between items-start">
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="Qantara" className="w-8 h-8 rounded-lg" />
            <span className="text-sm font-bold text-white tracking-tight">Qantara</span>
          </div>
          <Shield className="w-6 h-6 text-primary opacity-50" />
        </div>

        <div className="space-y-1">
          <p className="text-xs text-text-muted uppercase tracking-[0.2em]">Wallet Identity</p>
          <p className="text-xl font-mono font-bold text-white tracking-wider">
            {address.slice(0, 6)}••••{address.slice(-4)}
          </p>
        </div>

        <div className="flex justify-between items-end">
          <div className="space-y-1">
            <p className="text-xs text-text-muted uppercase tracking-widest">QIE Mainnet</p>
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              <span className="text-xs font-bold text-text-secondary uppercase tracking-widest">Testnet Active</span>
            </div>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); onQrClick?.(); }}
            className="w-10 h-10 bg-white/5 rounded-lg flex items-center justify-center border border-white/10 hover:bg-primary/10 hover:border-primary/30 transition-colors"
          >
            <QrCode className="w-6 h-6 text-text-secondary" />
          </button>
        </div>
      </div>
    </motion.div>
  );
}
