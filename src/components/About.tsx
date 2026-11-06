import { X } from 'lucide-react';
import { useFiltersStore } from '@/store/filters';
import { usePanelFocus } from '@/hooks/usePanelFocus';
import { APP_NAME, REPO_URL } from '@/config';

// Credits and the repo link. The map keeps one small credit line because its
// tile providers require attribution on the map itself.
const SOURCES: { name: string; href: string; what: string }[] = [
  { name: 'CARTO', href: 'https://carto.com/attributions', what: 'basemap tiles and styles' },
  { name: 'OpenStreetMap contributors', href: 'https://www.openstreetmap.org/copyright', what: 'map data (ODbL)' },
  { name: 'Esri World Imagery', href: 'https://www.esri.com/', what: 'Satellite theme imagery' },
  { name: 'MaxMind GeoLite2', href: 'https://www.maxmind.com', what: 'IP geolocation, via geoip-lite' },
  { name: 'NASA Visible Earth', href: 'https://visibleearth.nasa.gov/', what: 'globe textures, via three-globe' },
  { name: 'Natural Earth', href: 'https://www.naturalearthdata.com/', what: 'country shapes (public domain)' },
];

// GitHub's mark (Octicons mark-github, MIT); lucide no longer ships brand icons.
function GitHubMark() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0" fill="currentColor" aria-hidden="true">
      <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
    </svg>
  );
}

export default function About() {
  const open = useFiltersStore((s) => s.aboutOpen);
  const setAbout = useFiltersStore((s) => s.setAbout);
  const panelRef = usePanelFocus<HTMLDivElement>(open);
  if (!open) return null;
  const close = () => setAbout(false);
  const version = import.meta.env.VITE_APP_VERSION as string | undefined;

  return (
    <>
      <div className="fixed inset-0 z-30" onClick={close} aria-hidden="true" />
      <div
        className="hud-panel hud-scroll absolute outline-none right-4 top-[4.5rem] z-40 max-h-[70vh] w-80 overflow-y-auto rounded-xl border border-zinc-800 bg-black/90 p-3.5 text-xs backdrop-blur-sm max-[640px]:left-4 max-[640px]:w-auto"
        ref={panelRef}
        tabIndex={-1}
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
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-zinc-300 underline-offset-2 hover:underline"
            aria-label={`${APP_NAME} on GitHub`}
          >
            <GitHubMark />
            {APP_NAME}
          </a>
        </div>
      </div>
    </>
  );
}
