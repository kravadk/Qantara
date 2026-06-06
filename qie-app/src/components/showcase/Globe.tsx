import { useEffect, useRef, useState } from 'react';
import createGlobe from 'cobe';

/** Financial hubs that pulse on the globe — [lat, lng]. */
const MARKERS: { location: [number, number]; size: number }[] = [
  { location: [51.5074, -0.1278], size: 0.07 },   // London
  { location: [40.7128, -74.006], size: 0.08 },   // New York
  { location: [1.3521, 103.8198], size: 0.06 },   // Singapore
  { location: [25.2048, 55.2708], size: 0.06 },   // Dubai
  { location: [19.076, 72.8777], size: 0.06 },    // Mumbai
  { location: [35.6762, 139.6503], size: 0.06 },  // Tokyo
  { location: [37.7749, -122.4194], size: 0.07 }, // San Francisco
  { location: [-23.5505, -46.6333], size: 0.05 }, // São Paulo
];

/**
 * COBE WebGL globe tinted to the QIE magenta/purple palette.
 * Renders only while in the viewport (IntersectionObserver) and falls back to a
 * static gradient orb under prefers-reduced-motion or if WebGL init fails.
 */
export function Globe({ className = '' }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setFallback(true);
    }
  }, []);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const io = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { threshold: 0.1 },
    );
    io.observe(wrap);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!inView || fallback) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    let phi = 0;
    let width = canvas.offsetWidth || 1;
    const onResize = () => {
      width = canvas.offsetWidth || 1;
    };
    window.addEventListener('resize', onResize);

    let globe: { update: (state: Record<string, unknown>) => void; destroy: () => void };
    try {
      globe = createGlobe(canvas, {
        devicePixelRatio: 2,
        width: width * 2,
        height: width * 2,
        phi: 0,
        theta: 0.25,
        dark: 1,
        diffuse: 1.2,
        mapSamples: 16000,
        mapBrightness: 6,
        baseColor: [0.32, 0.18, 0.42],     // muted purple landmasses
        markerColor: [0.94, 0.17, 0.47],   // QIE magenta #F02C78
        glowColor: [0.49, 0.13, 0.81],     // QIE purple #7e22ce
        markers: MARKERS,
      });
    } catch {
      setFallback(true);
      window.removeEventListener('resize', onResize);
      return;
    }

    // cobe v2 has no onRender — drive rotation from our own RAF loop.
    let raf = 0;
    const tick = () => {
      phi += 0.004;
      globe.update({ phi, width: width * 2, height: width * 2 });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const reveal = requestAnimationFrame(() => {
      canvas.style.opacity = '1';
    });

    return () => {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(reveal);
      globe.destroy();
      window.removeEventListener('resize', onResize);
    };
  }, [inView, fallback]);

  return (
    <div ref={wrapRef} className={`relative aspect-square w-full max-w-[520px] ${className}`}>
      {fallback ? (
        <div
          aria-hidden
          className="absolute inset-[12%] rounded-full"
          style={{
            background:
              'radial-gradient(circle at 35% 30%, rgba(240,44,120,0.55), rgba(126,34,206,0.35) 45%, rgba(13,10,24,0.9) 75%)',
            boxShadow: '0 0 80px -10px rgba(240,44,120,0.4)',
          }}
        />
      ) : (
        <canvas
          ref={canvasRef}
          className="h-full w-full"
          style={{ contain: 'layout paint size', opacity: 0, transition: 'opacity 1s ease' }}
        />
      )}
    </div>
  );
}
