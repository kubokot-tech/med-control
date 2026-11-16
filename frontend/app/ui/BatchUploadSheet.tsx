'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'use-intl';
import BottomSheet from './BottomSheet';
import Icon from './icons';
import { apiFetch } from './labUtils';
import { guessDate, guessModality, looksLikeImaging, titleFrom } from './docGuess';
import { todayKey } from './api';
import { errorRu } from './api';
import { useMedLabels } from './medLabels';
import { MODALITIES, MODALITY_CT } from '../../../shared/medCodes.js';

type Row = { file: File; date: string; kind: string; title: string; modality: string };
type Result = { filename: string; ok: boolean; error?: string };

const KINDS = ['document', 'imaging', 'consult', 'histology', 'radiation', 'surgery', 'other'] as const;
const today = () => todayKey();

/**
 * Many files at once, one record per file. Dates and modality are guessed from
 * file names and can be corrected in place before creating.
 */
export default function BatchUploadSheet({ files, defaultKind = 'document', onClose, onDone }: { files: File[] | null; defaultKind?: string; onClose: () => void; onDone: () => void }) {
  const t = useTranslations('labs');
  const label = useMedLabels();
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [results, setResults] = useState<Result[] | null>(null);

  useEffect(() => {
    if (!files) { setRows([]); setResults(null); setErr(null); return; }
    setRows(files.map((f) => {
      const imaging = defaultKind === 'imaging' || looksLikeImaging(f.name);
      return { file: f, date: guessDate(f.name) || today(), kind: imaging ? 'imaging' : defaultKind, title: titleFrom(f.name), modality: guessModality(f.name) || MODALITY_CT };
    }));
    setResults(null); setErr(null);
  }, [files, defaultKind]);

  function patch(i: number, p: Partial<Row>) { setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r))); }
  function drop(i: number) { setRows((rs) => rs.filter((_, j) => j !== i)); }

  async function submit() {
    if (!rows.length) return;
    if (rows.some((r) => !r.date || !r.title.trim())) { setErr(t('batchUpload.needDateTitle')); return; }
    setBusy(true); setErr(null);
    try {
      const fd = new FormData();
      fd.set('meta', JSON.stringify(rows.map((r) => ({ date: r.date, kind: r.kind, title: r.title.trim(), ...(r.kind === 'imaging' ? { modality: r.modality } : {}) }))));
      for (const r of rows) fd.append('file', r.file, r.file.name);
      const res = await apiFetch('/api/gateway/milestones/batch', { method: 'POST', body: fd });
      const j = await res.json();
      if (!res.ok) throw new Error(errorRu(j));
      setResults(j.results);
      onDone();
    } catch (e: any) { setErr(String(e?.message || e)); } finally { setBusy(false); }
  }

  const okCount = results?.filter((r) => r.ok).length ?? 0;
  return (
    <BottomSheet open={files !== null} onClose={onClose} title={t('batchUpload.title')}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {!results && <div className="muted" style={{ fontSize: 14, lineHeight: 1.5 }}>{t('batchUpload.desc')}</div>}
        {err && <div className="msg msg--error">{err}</div>}
        {results && (
          <div className="msg msg--ok">{t('batchUpload.created', { ok: okCount, total: results.length })}{results.some((r) => !r.ok) && <> {t('batchUpload.failed', { files: results.filter((r) => !r.ok).map((r) => r.filename).join(', ') })}</>}</div>
        )}
        {!results && rows.map((r, i) => (
          <div key={i} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name={r.file.type.startsWith('image/') ? 'imaging' : 'doc'} size={18} />
              <span className="muted" style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{r.file.name} · {t('batchUpload.sizeMb', { size: (r.file.size / 1024 / 1024).toFixed(1) })}</span>
              <button type="button" className="ms-file__x" aria-label={t('batchUpload.removeFile')} onClick={() => drop(i)}><Icon name="close" size={16} /></button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <label className="field"><span>{t('batchUpload.date')}</span><input type="date" value={r.date} onChange={(e) => patch(i, { date: e.target.value })} /></label>
              <label className="field"><span>{t('batchUpload.kind')}</span>
                <select value={r.kind} onChange={(e) => patch(i, { kind: e.target.value })}>{KINDS.map((k) => <option key={k} value={k}>{t(`batchUpload.kinds.${k}`)}</option>)}</select>
              </label>
            </div>
            {r.kind === 'imaging' && (
              <div className="seg" style={{ flexWrap: 'wrap' }}>{MODALITIES.map((m) => <button key={m} type="button" className={`seg__btn ${r.modality === m ? 'seg__btn--active' : ''}`} onClick={() => patch(i, { modality: m })}>{label.modality(m)}</button>)}</div>
            )}
            <label className="field"><span>{t('batchUpload.name')}</span><input value={r.title} onChange={(e) => patch(i, { title: e.target.value })} maxLength={200} /></label>
          </div>
        ))}
        {!results && rows.length > 0 && (
          <button type="button" className="btn btn--primary btn--lg btn--block" onClick={submit} disabled={busy}>
            <Icon name="check" strokeWidth={2.2} />{busy ? t('batchUpload.uploading') : t('batchUpload.create', { n: rows.length })}
          </button>
        )}
        {results && <button type="button" className="btn btn--secondary btn--block" onClick={onClose}>{t('batchUpload.done')}</button>}
      </div>
    </BottomSheet>
  );
}
