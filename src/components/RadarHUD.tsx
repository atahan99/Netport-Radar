import { useEffect, useRef } from 'react';
import { useFlightsStore } from '@/store/flights';

const S = 120;

export default function RadarHUD() {
  const ref = useRef<HTMLCanvasElement>(null);

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
      ctx.clearRect(0, 0, S, S);
      ctx.strokeStyle = 'rgba(0,255,65,0.15)';
      ctx.lineWidth = 1;
      for (const r of [20, 40, 56]) {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(0,255,65,0.1)';
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
            ctx.fillStyle = `rgba(0,255,65,${alpha})`;
            ctx.beginPath();
            ctx.arc(x, y, 2.5, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      const sr = (sweep * Math.PI) / 180;
      ctx.strokeStyle = 'rgba(0,255,65,0.6)';
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
      className="relative rounded-lg border border-zinc-800 bg-black/85 p-1 backdrop-blur-sm"
      style={{ width: 128 }}
    >
      <canvas ref={ref} style={{ width: S, height: S, display: 'block' }} />
      <div className="pointer-events-none absolute inset-x-0 top-2 text-center text-[8px] tracking-wider text-zinc-600">
        netport-radar
      </div>
    </div>
  );
}
