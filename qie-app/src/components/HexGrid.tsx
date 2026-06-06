import { motion, useMotionValue, useSpring } from 'framer-motion';
import { useEffect, useRef } from 'react';

export function HexGrid() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);

  const springConfig = { damping: 25, stiffness: 150 };
  const smoothX = useSpring(mouseX, springConfig);
  const smoothY = useSpring(mouseY, springConfig);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const { left, top } = containerRef.current.getBoundingClientRect();
      mouseX.set(e.clientX - left);
      mouseY.set(e.clientY - top);
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [mouseX, mouseY]);

  return (
    <div ref={containerRef} className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
      <svg className="w-full h-full opacity-[0.03] text-primary">
        <pattern
          id="hex-grid"
          width="50"
          height="43.4"
          patternUnits="userSpaceOnUse"
          patternTransform="scale(1.5)"
        >
          <path
            d="M25 0L50 14.4V43.4L25 57.8L0 43.4V14.4L25 0Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
          />
        </pattern>
        <rect width="100%" height="100%" fill="url(#hex-grid)" />
      </svg>
      <motion.div
        style={{
          left: smoothX,
          top: smoothY,
          background: 'radial-gradient(circle, var(--accent-primary) 0%, transparent 70%)',
        }}
        className="absolute w-[300px] h-[300px] -translate-x-1/2 -translate-y-1/2 opacity-[0.08] blur-[80px]"
      />
    </div>
  );
}
