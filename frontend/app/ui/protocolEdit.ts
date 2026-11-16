'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'use-intl';
import { apiFetch } from './labUtils';
import { errorRu } from './api';
import { loadProtocol, setProtocolCache, type Protocol, type ProtocolResponse } from './protocol';

/**
 * One part of the treatment protocol on its own page (thresholds, scales, notes, texts): the page edits its part of a
 * copy, Save sends the whole protocol back (PUT /protocol), so pages never overwrite each other's parts.
 */
export function useProtocolEdit() {
  const t = useTranslations('protocol');
  const [data, setData] = useState<ProtocolResponse | null>(null);
  const [form, setForm] = useState<Protocol | null>(null);
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await loadProtocol(true);
    if (!r) return;
    setData(r); setForm(r.protocol); setSaved(JSON.stringify(r.protocol));
  }, []);
  useEffect(() => { load(); }, [load]);

  const dirty = form != null && JSON.stringify(form) !== saved;
  const catalogByKey = useMemo(() => new Map((data?.catalog || []).map((c) => [c.key, c])), [data]);

  async function save(done = t('saved')) {
    if (!form) return;
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await apiFetch('/api/gateway/protocol', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(errorRu(j));
      if (data) setProtocolCache({ ...data, protocol: j.protocol, stored: true });
      setMsg(done);
      await load();
    } catch (e: any) { setErr(String(e?.message || e)); } finally { setBusy(false); }
  }
  const reset = () => { if (data) setForm(data.protocol); setMsg(null); setErr(null); };

  return { data, form, setForm, dirty, busy, setBusy, msg, setMsg, err, setErr, save, reset, reload: load, catalogByKey };
}
