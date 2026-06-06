import { useEffect, useRef } from 'react';

/**
 * Cursor-tracking flashlight glow. Writes the pointer position
 * into CSS custom properties (--mx / --my) consumed by the `.flashlight` utility
 * in index.css. Desktop-only: skipped on coarse pointers and when the user
 * prefers reduced motion. Pure visual layer — never intercepts pointer events.
 */
export function FlashlightBackdrop({ className = '' }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const fine = window.matchMedia('(pointer: fine)').matches;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!fine || reduced) return;

    let frame = 0;
    const onMove = (e: MouseEvent) => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const rect = el.getBoundingClientRect();
        el.style.setProperty('--mx', `${e.clientX - rect.left}px`);
        el.style.setProperty('--my', `${e.clientY - rect.top}px`);
      });
    };

    window.addEventListener('mousemove', onMove, { passive: true });
    return () => {
      window.removeEventListener('mousemove', onMove);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return <div ref={ref} aria-hidden className={`flashlight pointer-events-none absolute inset-0 z-0 ${className}`} />;
}
