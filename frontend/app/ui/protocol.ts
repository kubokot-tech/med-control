'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from './labUtils';

export type LabRule = { key: string; severity: 'RED' | 'YELLOW'; op: 'lt' | 'lte' | 'gt' | 'gte' | 'gtRef' | 'ltRef'; value: number; message: string };
export type ProtocolAgent = { name: string; shortName?: string | null; defaultDose?: number | null; doseUnit?: string | null; notes?: string | null; sortOrder?: number };
export type ProtocolRegimen = { name: string; form?: string | null; role: 'systemic' | 'support'; doseValue?: number | null; doseUnit?: string | null; timesPerDay?: number; instructions?: string | null };
export type Protocol = {
  preset: string | null; name: string; status: 'ready' | 'example' | 'custom'; summary: string; aiNotes: string; labCadenceHint: string;
  labRules: LabRule[]; regimen: ProtocolRegimen | null; infusionAgents: ProtocolAgent[]; markerNotes: Record<string, string>;
  diaryScales: string[];
};
export type Preset = { id: string; name: string; status: 'ready' | 'example'; summary: string };
export type CatalogEntry = { key: string; name: string; unit: string | null };
export type ScaleDef = { key: string; label: string; hint: string };
export type ProtocolResponse = { protocol: Protocol; stored: boolean; presets: Preset[]; catalog: CatalogEntry[]; scaleCatalog: ScaleDef[] };
// Status and condition labels are in the dictionary: protocol.status.<status>, protocol.op.<op> (locales/ru/protocol.json).

let cache: ProtocolResponse | null = null;
let inflight: Promise<ProtocolResponse | null> | null = null;
const listeners = new Set<(p: ProtocolResponse | null) => void>();

export async function loadProtocol(force = false): Promise<ProtocolResponse | null> {
  if (cache && !force) return cache;
  if (inflight && !force) return inflight;
  inflight = (async () => {
    try {
      const r = await apiFetch('/api/gateway/protocol');
      if (!r.ok) return cache;
      cache = (await r.json()) as ProtocolResponse;
      listeners.forEach((fn) => fn(cache));
      return cache;
    } catch { return cache; } finally { inflight = null; }
  })();
  return inflight;
}
export function setProtocolCache(next: ProtocolResponse) { cache = next; listeners.forEach((fn) => fn(cache)); }

/** Current protocol (shared cache, one request per page). */
export function useProtocol(): Protocol | null {
  const [p, setP] = useState<Protocol | null>(cache?.protocol ?? null);
  useEffect(() => {
    const fn = (r: ProtocolResponse | null) => setP(r?.protocol ?? null);
    listeners.add(fn);
    loadProtocol().then(fn);
    return () => { listeners.delete(fn); };
  }, []);
  return p;
}
