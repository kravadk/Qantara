import { useEffect, useRef } from 'react';

/**
 * Settlement mesh — a living node network rendered on a 2D canvas.
 *
 * Drifting nodes connected by proximity edges; "settlement pulses" travel along
 * edges; nodes near the cursor brighten and gently repel (parallax depth).
 * Pure canvas2d, no deps, no images. Magenta/purple over near-black. Respects
 * prefers-reduced-motion (renders a single static frame) and pauses when the tab
 * is hidden.
 */

interface Node { x: number; y: number; vx: number; vy: number; r: number }
interface Pulse { a: number; b: number; t: number; speed: number }

const MAGENTA = [240, 44, 120] as const;
const PURPLE = [168, 85, 247] as const;

export function SettlementMesh() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let w = 0, h = 0, dpr = 1;
    let nodes: Node[] = [];
    const pulses: Pulse[] = [];
    const mouse = { x: -9999, y: -9999, active: false };
    let raf = 0;

    const LINK_DIST = 184;        // px proximity for an edge
    const MOUSE_RADIUS = 190;

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const target = Math.round((w * h) / 15000);
      const count = Math.max(60, Math.min(150, target));
      nodes = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.22,
        vy: (Math.random() - 0.5) * 0.22,
        r: 0.8 + Math.random() * 1.6,
      }));
    }

    function maybeSpawnPulse() {
      if (pulses.length > 18) return;
      if (Math.random() > 0.1) return;
      const a = (Math.random() * nodes.length) | 0;
      // find a near neighbour to travel to
      let best = -1, bestD = LINK_DIST * LINK_DIST;
      for (let b = 0; b < nodes.length; b++) {
        if (b === a) continue;
        const dx = nodes[a].x - nodes[b].x, dy = nodes[a].y - nodes[b].y;
        const d = dx * dx + dy * dy;
        if (d < bestD && Math.random() > 0.6) { best = b; bestD = d; }
      }
      if (best >= 0) pulses.push({ a, b: best, t: 0, speed: 0.012 + Math.random() * 0.02 });
    }

    function draw() {
      ctx.clearRect(0, 0, w, h);

      // edges
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          const dx = a.x - b.x, dy = a.y - b.y;
          const dist = Math.hypot(dx, dy);
          if (dist > LINK_DIST) continue;
          const prox = 1 - dist / LINK_DIST;
          const c = prox > 0.55 ? MAGENTA : PURPLE;
          ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${(prox * prox * 0.55).toFixed(3)})`;
          ctx.lineWidth = prox > 0.7 ? 1.2 : 0.7;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }

      // pulses
      for (let k = pulses.length - 1; k >= 0; k--) {
        const p = pulses[k];
        const a = nodes[p.a], b = nodes[p.b];
        if (!a || !b) { pulses.splice(k, 1); continue; }
        p.t += p.speed;
        if (p.t >= 1) { pulses.splice(k, 1); continue; }
        const x = a.x + (b.x - a.x) * p.t;
        const y = a.y + (b.y - a.y) * p.t;
        const fade = Math.sin(p.t * Math.PI);
        ctx.fillStyle = `rgba(255,90,160,${(0.9 * fade).toFixed(3)})`;
        ctx.shadowColor = 'rgba(240,44,120,0.9)';
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.arc(x, y, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      // nodes
      for (const n of nodes) {
        let bright = 0;
        if (mouse.active) {
          const d = Math.hypot(n.x - mouse.x, n.y - mouse.y);
          if (d < MOUSE_RADIUS) bright = 1 - d / MOUSE_RADIUS;
        }
        const alpha = 0.5 + bright * 0.5;
        ctx.fillStyle = `rgba(${MAGENTA[0]},${MAGENTA[1]},${MAGENTA[2]},${alpha.toFixed(3)})`;
        ctx.shadowColor = 'rgba(240,44,120,0.9)';
        ctx.shadowBlur = 6 + bright * 12;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r + 0.4 + bright * 1.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    function step() {
      for (const n of nodes) {
        n.x += n.vx;
        n.y += n.vy;
        // gentle cursor repulsion
        if (mouse.active) {
          const dx = n.x - mouse.x, dy = n.y - mouse.y;
          const d = Math.hypot(dx, dy);
          if (d < MOUSE_RADIUS && d > 0.01) {
            const f = ((MOUSE_RADIUS - d) / MOUSE_RADIUS) * 0.4;
            n.x += (dx / d) * f;
            n.y += (dy / d) * f;
          }
        }
        // wrap
        if (n.x < -20) n.x = w + 20; else if (n.x > w + 20) n.x = -20;
        if (n.y < -20) n.y = h + 20; else if (n.y > h + 20) n.y = -20;
      }
      maybeSpawnPulse();
      draw();
      raf = requestAnimationFrame(step);
    }

    const onMove = (e: MouseEvent) => { mouse.x = e.clientX; mouse.y = e.clientY; mouse.active = true; };
    const onLeave = () => { mouse.active = false; mouse.x = -9999; mouse.y = -9999; };
    const onVisibility = () => {
      if (document.hidden) { cancelAnimationFrame(raf); raf = 0; }
      else if (!reduce && !raf) { raf = requestAnimationFrame(step); }
    };

    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('mousemove', onMove, { passive: true });
    window.addEventListener('mouseout', onLeave);
    document.addEventListener('visibilitychange', onVisibility);

    if (reduce) {
      draw(); // single static frame
    } else {
      raf = requestAnimationFrame(step);
    }

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseout', onLeave);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden className="absolute inset-0 h-full w-full" />;
}
