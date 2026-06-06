import { ReactNode } from 'react';

interface MarqueeProps {
  items: ReactNode[];
  /** seconds for one full loop */
  duration?: number;
  reverse?: boolean;
  className?: string;
}

/**
 * Infinite horizontal marquee. The row is rendered
 * twice back-to-back and translated -50%, so the loop is seamless. Pauses on
 * hover; edges fade via `.marquee-mask`. Continuous motion is disabled under
 * prefers-reduced-motion (handled in index.css).
 */
export function Marquee({ items, duration = 28, reverse = false, className = '' }: MarqueeProps) {
  const row = [...items, ...items];
  return (
    <div className={`marquee-pause marquee-mask relative w-full overflow-hidden ${className}`}>
      <div
        className={`flex w-max items-center gap-4 ${reverse ? 'animate-marquee-reverse' : 'animate-marquee'}`}
        style={{ ['--marquee-duration' as string]: `${duration}s` }}
      >
        {row.map((item, i) => (
          <div key={i} className="shrink-0" aria-hidden={i >= items.length}>
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}
