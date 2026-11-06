import { X } from 'lucide-react';
import { useFiltersStore } from '@/store/filters';
import { APP_NAME, REPO_URL } from '@/config';

// Credits live here instead of a pill on the map. The map still keeps the
// small collapsed ⓘ attribution its tile providers require.
const SOURCES: { name: string; href: string; what: string }[] = [
  { name: 'CARTO', href: 'https://carto.com/attributions', what: 'basemap tiles and styles' },
  { name: 'OpenStreetMap contributors', href: 'https://www.openstreetmap.org/copyright', what: 'map data (ODbL)' },
  { name: 'Esri World Imagery', href: 'https://www.esri.com/', what: 'Satellite theme imagery' },
  { name: 'MaxMind GeoLite2', href: 'https://www.maxmind.com', what: 'IP geolocation, via geoip-lite' },
  { name: 'NASA Visible Earth', href: 'https://visibleearth.nasa.gov/', what: 'globe textures, via three-globe' },
  { name: 'Natural Earth', href: 'https://www.naturalearthdata.com/', what: 'country shapes (public domain)' },
];

export default function About() {
  const open = useFiltersStore((s) => s.aboutOpen);
  const setAbout = useFiltersStore((s) => s.setAbout);
  if (!open) return null;
  const close = () => setAbout(false);
  const version = import.meta.env.VITE_APP_VERSION as string | undefined;

  return (
    <>
      <div className="fixed inset-0 z-30" onClick={close} aria-hidden="true" />
      <div
        className="hud-panel hud-scroll absolute right-4 top-[4.5rem] z-40 max-h-[70vh] w-80 overflow-y-auto rounded-xl border border-zinc-800 bg-black/90 p-3.5 text-xs backdrop-blur-sm max-[640px]:left-4 max-[640px]:w-auto"
        role="dialog"
        aria-label={`About ${APP_NAME}`}
      >
        <div className="mb-2 flex items-center justify-between">
          <span className="font-mono text-[11px] font-semibold tracking-wider text-zinc-300">
            {APP_NAME.toUpperCase()}
            {version && <span className="ml-2 font-normal text-zinc-500">v{version}</span>}
          </span>
          <button onClick={close} className="rounded p-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200" aria-label="Close about">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <p className="leading-relaxed text-zinc-400">
          A read-only network monitor: every connection on this machine is drawn as a flight to the remote IP&apos;s
          country. Capture and inspection run locally and never touch the traffic.
        </p>

        <div className="mb-1 mt-3 font-mono text-[10px] uppercase tracking-wide text-zinc-500">Data &amp; sources</div>
        <ul className="space-y-1">
          {SOURCES.map((s) => (
            <li key={s.name} className="flex flex-col">
              <a href={s.href} target="_blank" rel="noreferrer" className="text-zinc-200 underline-offset-2 hover:underline">
                {s.name}
              </a>
              <span className="text-[11px] text-zinc-500">{s.what}</span>
            </li>
          ))}
        </ul>

        <div className="mt-3 flex items-center justify-between border-t border-zinc-800 pt-2 text-[11px] text-zinc-500">
          <span>MIT licensed</span>
          <a href={REPO_URL} target="_blank" rel="noreferrer" className="text-zinc-300 underline-offset-2 hover:underline">
            Source on GitHub
          </a>
        </div>
      </div>
    </>
  );
}
