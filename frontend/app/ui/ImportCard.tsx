'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'use-intl';
import Icon from './icons';
import { apiFetch } from './labUtils';
import { apiJson, errorRu } from './api';
import FileButton from './FileButton';

type Result = { tables: Record<string, number>; files: number };
/** Tables counted after the load, with their wording in `importCard.tables`. */
const SHOWN: [string, 'labResults' | 'medications' | 'symptomEntries' | 'notes' | 'milestones' | 'appointments' | 'contacts'][] = [['lab_results', 'labResults'], ['medications', 'medications'], ['symptom_entries', 'symptomEntries'], ['notes', 'notes'], ['milestones', 'milestones'], ['appointments', 'appointments'], ['contacts', 'contacts']];

/**
 * The full data archive (ExportCard) loaded back: moving to another computer or between the server and the desktop app,
 * restoring from one's own copy. Only into an installation without records yet (the gateway refuses otherwise).
 */
export default function ImportCard() {
  const t = useTranslations('settings');
  const [empty, setEmpty] = useState<boolean | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<Result | null>(null);

  useEffect(() => { apiJson<{ empty: boolean }>('/api/gateway/import/status').then((r) => setEmpty(r.empty)).catch(() => setEmpty(false)); }, []);

  async function load() {
    if (!file) return;
    setBusy(true); setErr(null);
    try {
      // the password first: the gateway checks it before taking the file
      const fd = new FormData();
      fd.append('password', password);
      fd.append('archive', file, file.name);
      const r = await apiFetch('/api/gateway/import/archive', { method: 'POST', body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(errorRu(j, t('importCard.failed', { status: r.status })));
      setDone(j as Result); setEmpty(false); setPassword(''); setFile(null);
    } catch (e: any) { setErr(String(e?.message || e)); } finally { setBusy(false); }
  }

  if (empty === null) return null;
  return (
    <div className="card meds-card">
      <div className="card__title">{t('importCard.title')}</div>
      {done ? (
        <div className="msg msg--ok" style={{ lineHeight: 1.5 }}>
          {t.rich('importCard.done', { tables: SHOWN.filter(([table]) => done.tables[table]).map(([table, w]) => t(`importCard.tables.${w}`, { n: done.tables[table] })).join(', ') || t('importCard.noRecords'), files: done.files, home: (c) => <a href="/">{c}</a> })}
        </div>
      ) : !empty ? (
        <div className="muted" style={{ fontSize: 14, lineHeight: 1.5 }}>
          {t('importCard.notEmpty')}
        </div>
      ) : (
        <>
          <div className="muted" style={{ fontSize: 14, lineHeight: 1.5 }}>
            {t('importCard.intro')}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <FileButton className="btn btn--secondary btn--sm" accept=".zip,application/zip" disabled={busy} onFiles={(files) => setFile(files[0] || null)}>{t('importCard.choose')}</FileButton>
            {file && <span className="muted" style={{ fontSize: 14, wordBreak: 'break-all' }}>{t('importCard.file', { name: file.name, size: (file.size / 1024 / 1024).toFixed(1) })}</span>}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t('importCard.passwordPlaceholder')} autoComplete="current-password" style={{ width: 170 }} aria-label={t('importCard.passwordLabel')} />
            <button type="button" className="btn btn--primary btn--sm" onClick={load} disabled={busy || !file || !password}><Icon name="upload" size={18} />{busy ? t('importCard.loading') : t('importCard.load')}</button>
          </div>
          {busy && <div className="muted" style={{ fontSize: 13 }}>{t('importCard.slow')}</div>}
        </>
      )}
      {err && <div className="msg msg--error">{err}</div>}
    </div>
  );
}
