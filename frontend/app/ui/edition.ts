'use client';

import { useEffect, useState } from 'react';

/** Server or desktop edition (GET /edition, gateway/src/lib/edition.js): which features this installation lacks. */
export type Edition = { edition: 'server' | 'desktop'; unavailable: string[] };
const SERVER: Edition = { edition: 'server', unavailable: [] };

let cache: Edition | null = null;
let inflight: Promise<Edition> | null = null;
function loadEdition(): Promise<Edition> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = fetch('/api/gateway/edition', { cache: 'no-store' })
      .then(async (r) => (r.ok ? ((cache = (await r.json()) as Edition)) : SERVER))
      .catch(() => SERVER)
      .finally(() => { inflight = null; });
  }
  return inflight;
}

/** { edition, available(feature) }; until loaded everything counts as available (the server edition). */
export function useEdition() {
  const [e, setE] = useState<Edition>(cache || SERVER);
  useEffect(() => { loadEdition().then(setE); }, []);
  return { edition: e.edition, desktop: e.edition === 'desktop', available: (feature: string) => !e.unavailable.includes(feature) };
}
