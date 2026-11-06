import { useEffect, useRef } from 'react';
import { useFlightsStore } from '@/store/flights';
import { useFiltersStore } from '@/store/filters';
import { globeRef, flightCardRef } from '@/lib/view-refs';
import { flightWorldPos } from '@/lib/flight-pos';

const GLOBE_R = 100;

// Leader line from the selected plane to the docked card. Updates its endpoints
// every frame via direct SVG attribute writes (no per-frame React, and globeRef
// is never read during render). Self-hides
// when there's no docked selection or the plane is behind the globe's horizon.
export default function LeaderLine({ w, h }: { w: number; h: number }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const lineRef = useRef<SVGLineElement>(null);
  const dotRef = useRef<SVGCircleElement>(null);

  useEffect(() => {
    let raf = 0;
    // The docked card rarely moves: measure it when it (re)mounts or at most
    // twice a second, instead of forcing layout every frame.
    let cardEl: HTMLElement | null = null;
    let cardRect: DOMRect | null = null;
    let measuredAt = 0;
    const cardBox = (now: number): DOMRect | null => {
      const el = flightCardRef.current;
      if (el !== cardEl || now - measuredAt > 500) {
        cardEl = el;
        cardRect = el?.getBoundingClientRect() ?? null;
        measuredAt = now;
      }
      return cardRect;
    };
    const tick = () => {
      const svg = svgRef.current;
      const line = lineRef.current;
      const dot = dotRef.current;
      const g = globeRef.current;
      let show = false;
      if (svg && line && dot && g) {
        const { selectedFlightId: sel, flights, homeAirports } = useFlightsStore.getState();
        const docked = useFiltersStore.getState().cardAnchor3d === 'docked';
        const f = sel && docked ? flights.find((x) => x.id === sel) : undefined;
        if (f) {
          const home = homeAirports.find((a) => a.id === f.homeAirportId);
          const p = flightWorldPos(f, home, performance.now());
          const sc = g.getScreenCoords(p.lat, p.lng, p.alt);
          let visible = true;
          try {
            const P = g.getCoords(p.lat, p.lng, 0);
            const C = g.camera().position;
            visible = P.x * C.x + P.y * C.y + P.z * C.z > GLOBE_R * GLOBE_R;
          } catch {
            /* keep */
          }
          if (visible) {
            const card = cardBox(performance.now());
            const x2 = card ? card.left + card.width / 2 : w / 2;
            const y2 = card ? card.top : h - 16;
            line.setAttribute('x1', String(sc.x));
            line.setAttribute('y1', String(sc.y));
            line.setAttribute('x2', String(x2));
            line.setAttribute('y2', String(y2));
            dot.setAttribute('cx', String(sc.x));
            dot.setAttribute('cy', String(sc.y));
            show = true;
          }
        }
      }
      if (svg) svg.style.display = show ? 'block' : 'none';
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [w, h]);

  return (
    <svg
      ref={svgRef}
      className="pointer-events-none absolute inset-0 z-20"
      width={w}
      height={h}
      style={{ display: 'none' }}
    >
      <line ref={lineRef} stroke="rgba(255,255,255,0.45)" strokeWidth={1} strokeDasharray="3 3" />
      <circle ref={dotRef} r={3} fill="none" stroke="rgba(255,255,255,0.7)" />
    </svg>
  );
}
