import { useState, useEffect } from 'react';
import { motion, useSpring } from 'framer-motion';

export function CustomCursor() {
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMousePosition({ x: e.clientX, y: e.clientY });
    };

    const checkMobile = () => {
      setIsMobile('ontouchstart' in window || navigator.maxTouchPoints > 0);
    };

    checkMobile();
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  const springConfig = { damping: 25, stiffness: 250 };
  const cursorX = useSpring(mousePosition.x - 3, springConfig);
  const cursorY = useSpring(mousePosition.y - 3, springConfig);
  
  const outerX = useSpring(mousePosition.x - 14, { damping: 20, stiffness: 150 });
  const outerY = useSpring(mousePosition.y - 14, { damping: 20, stiffness: 150 });

  if (isMobile) return null;

  return (
    <>
      <motion.div
        style={{ x: cursorX, y: cursorY }}
        className="fixed top-0 left-0 w-1.5 h-1.5 bg-primary rounded-full z-[10000] pointer-events-none opacity-40"
      />
      <motion.div
        style={{ x: outerX, y: outerY }}
        className="fixed top-0 left-0 w-7 h-7 border border-primary rounded-full z-[10000] pointer-events-none opacity-15"
      />
    </>
  );
}
