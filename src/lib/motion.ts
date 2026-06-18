// src/lib/motion.ts
// prefers-reduced-motion flag, cached and kept in sync via a media-query
// listener. Read synchronously by lifecyclePose + the views (no React subscribe).
// Guarded for non-DOM environments (tests).

let reduced = false;
if (typeof matchMedia !== 'undefined') {
  const mq = matchMedia('(prefers-reduced-motion: reduce)');
  reduced = mq.matches;
  mq.addEventListener('change', (e) => {
    reduced = e.matches;
  });
}

export function reducedMotion(): boolean {
  return reduced;
}
