'use client';

import { useState } from 'react';
import { useTranslations } from 'use-intl';
import Icon from './icons';
import { apiFetch } from './labUtils';
import { errorRu, todayKey } from './api';

/** Everything in one ZIP: for your own archive or moving to another system. */
export default function ExportCard() {
  const t = useTranslations('settings');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function exportAll() {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await apiFetch('/api/gateway/export/all.zip');
      if (!r.ok) throw new Error(errorRu(await r.json().catch(() => ({}))));
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement('a');
      a.href = url; a.download = `medcontrol-export-${todayKey()}.zip`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      setMsg(t('exportCard.done'));
    } catch (e: any) { setErr(String(e?.message || e)); } finally { setBusy(false); }
  }

  return (
    <div className="card meds-card">
      <div className="muted" style={{ fontSize: 14, lineHeight: 1.5 }}>{t('exportCard.intro')}</div>
      <div><button type="button" className="btn btn--primary" onClick={exportAll} disabled={busy}><Icon name="download" />{busy ? t('exportCard.collecting') : t('exportCard.download')}</button></div>
      {err && <div className="msg msg--error">{err}</div>}
      {msg && <div className="msg msg--ok">{msg}</div>}
    </div>
  );
}
