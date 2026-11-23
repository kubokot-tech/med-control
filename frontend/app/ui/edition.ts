'use client';

import { useEffect, useState } from 'react';

/** Server or desktop edition (GET /edition). The static iPad build knows its own gaps before the gateway answers. */
export type Edition = { edition: 'server' | 'desktop'; unavailable: string[] };
const SERVER: Edition = { edition: 'server', unavailable: [] };
const STATIC_IPAD: Edition = {
  edition: 'desktop',
  unavailable: ['appleHealth', 'dicom', 'backups', 'passkeys', 'egress', 'telegram'],
};
const STATIC = process.env.NEXT_PUBLIC_STATIC_EXPORT === '1';
const INITIAL: Edition = STATIC ? STATIC_IPAD : SERVER;

let cache: Edition | null = null;
let inflight: Promise<Edition> | null = null;
function loadEdition(): Promise<Edition> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = fetch('/api/gateway/edition', { cache: 'no-store' })
      .then(async (r) => (r.ok ? ((cache = (await r.json()) as Edition)) : INITIAL))
      .catch(() => INITIAL)
      .finally(() => { inflight = null; });
  }
  return inflight;
}

/** { edition, available(feature) }. A static export starts from the iPad list; a server build starts with everything available. */
export function useEdition() {
  const [e, setE] = useState<Edition>(cache || INITIAL);
  useEffect(() => { loadEdition().then(setE); }, []);
  return { edition: e.edition, desktop: e.edition === 'desktop', available: (feature: string) => !e.unavailable.includes(feature) };
}
