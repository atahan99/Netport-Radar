import { useEffect, useRef } from 'react';
import { useFlightsStore } from '@/store/flights';
import { useFiltersStore } from '@/store/filters';
import { THEME_BY_ID } from '@/lib/themes';

const S = 120;

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export default function RadarHUD() {
  const ref = useRef<HTMLCanvasElement>(null);
  const accent = useFiltersStore((s) => THEME_BY_ID[s.theme]?.accent ?? '#00ff41');

  // Mutable color the rAF draw loop reads each frame; updated on theme change
  // without tearing down the animation.
  const rgb = useRef<[number, number, number]>(hexToRgb(accent));
  useEffect(() => {
    rgb.current = hexToRgb(accent);
  }, [accent]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = S * dpr;
    canvas.height = S * dpr;
    ctx.scale(dpr, dpr);
    const cx = S / 2;
    const cy = S / 2;
    let sweep = 0;
    let raf = 0;

    const draw = () => {
      const [cr, cg, cb] = rgb.current;
      const col = (a: number) => `rgba(${cr},${cg},${cb},${a})`;
      ctx.clearRect(0, 0, S, S);
      ctx.strokeStyle = col(0.15);
      ctx.lineWidth = 1;
      for (const r of [20, 40, 56]) {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.strokeStyle = col(0.1);
      ctx.beginPath();
      ctx.moveTo(cx, 6);
      ctx.lineTo(cx, S - 6);
      ctx.moveTo(6, cy);
      ctx.lineTo(S - 6, cy);
      ctx.stroke();

      const { flights, homeAirports } = useFlightsStore.getState();
      const home = homeAirports[0];
      if (home) {
        for (const f of flights) {
          if (f.phase === 'landed' || f.phase === 'taxi') continue;
          let dlng = f.dstLng - home.lng;
          if (dlng > 180) dlng -= 360;
          if (dlng < -180) dlng += 360;
          const dlat = f.dstLat - home.lat;
          const ang = Math.atan2(dlng, dlat);
          const dist = Math.min(1, Math.hypot(dlng, dlat) / 170);
          const r = 8 + dist * 46;
          const x = cx + r * Math.sin(ang);
          const y = cy - r * Math.cos(ang);
          const angDeg = (ang * 180) / Math.PI;
          const delta = (sweep - angDeg + 360) % 360;
          const alpha = delta < 90 ? 1 - delta / 90 : 0;
          if (alpha > 0.03) {
            ctx.fillStyle = col(alpha);
            ctx.beginPath();
            ctx.arc(x, y, 2.5, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      const sr = (sweep * Math.PI) / 180;
      ctx.strokeStyle = col(0.6);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + 56 * Math.sin(sr), cy - 56 * Math.cos(sr));
      ctx.stroke();

      sweep = (sweep + 2) % 360;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      aria-hidden="true"
      className="relative rounded-xl border border-zinc-800 bg-black/85 p-1 backdrop-blur-sm"
      style={{ width: 152 }}
    >
      <canvas ref={ref} className="mx-auto" style={{ width: S, height: S, display: 'block' }} />
      {/* The app's wordmark lives here, in the accent color (the old centered one sat under the toolbar). */}
      <div
        className="pointer-events-none absolute inset-x-0 top-2 text-center text-[10px] font-semibold tracking-[0.3em]"
        style={{ color: 'var(--theme-accent, #a1a1aa)' }}
      >
        NETPORT·RADAR
      </div>
    </div>
  );
}
