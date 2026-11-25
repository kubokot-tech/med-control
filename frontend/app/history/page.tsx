'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'use-intl';
import Icon, { type IconName } from '../ui/icons';
import BottomSheet from '../ui/BottomSheet';
import { apiFetch, openAttachment } from '../ui/labUtils';
import BatchUploadSheet from '../ui/BatchUploadSheet';
import { todayKey } from '../ui/api';
import { errorRu } from '../ui/api';
import { useFormat } from '../ui/format';
import EmptyState from '../ui/EmptyState';
import FileButton from '../ui/FileButton';

type Extract = { method: 'pdf_text' | 'llm' | 'ocr'; model: string | null; chars: number; hasSummary?: boolean };
type Attachment = { sha256: string; filename: string | null; mimeType: string | null; extract?: Extract | null };
type Milestone = {
  id: string; date: string; kind: string; tone: 'positive' | 'negative' | 'neutral' | string;
  title: string; notes: string | null; attachments: Attachment[];
};
type Form = { date: string; kind: string; tone: string; title: string; notes: string };

// labels: history.kinds.<key> and history.tones.<key>
type Kind = 'surgery' | 'radiation' | 'histology' | 'imaging' | 'consult' | 'document' | 'other' | 'ai_review';
const KINDS: { key: Kind; icon: IconName }[] = [
  { key: 'surgery', icon: 'plus' },
  { key: 'radiation', icon: 'bell' },
  { key: 'histology', icon: 'labs' },
  { key: 'imaging', icon: 'imaging' },
  { key: 'consult', icon: 'consult' },
  { key: 'document', icon: 'doc' },
  { key: 'other', icon: 'info' },
  { key: 'ai_review', icon: 'info' },
];
type Tone = 'positive' | 'neutral' | 'negative';
const TONES: Tone[] = ['positive', 'neutral', 'negative'];
const isTone = (s: string): s is Tone => (TONES as string[]).includes(s);
const emptyForm = (date: string): Form => ({ date, kind: 'imaging', tone: 'neutral', title: '', notes: '' });


export default function HistoryPage() {
  const t = useTranslations('history');
  const f = useFormat();
  const fmtDate = (key: string) => f.date(key, { day: 'numeric', month: 'long', year: 'numeric' });
  const [items, setItems] = useState<Milestone[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<Milestone | null | 'new'>(null);
  const [form, setForm] = useState<Form>(emptyForm(todayKey()));
  const [busy, setBusy] = useState(false);
  const [batchFiles, setBatchFiles] = useState<File[] | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const r = await apiFetch('/api/gateway/milestones');
      if (!r.ok) throw new Error(await r.text());
      setItems((await r.json()).milestones || []);
    } catch (e: any) {
      setErr(String(e?.message || e));
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (items && window.location.hash) document.getElementById(window.location.hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, [items]);

  function openNew() {
    setForm(emptyForm(todayKey()));
    setEditing('new');
  }
  function openEdit(m: Milestone) {
    setForm({ date: m.date, kind: m.kind, tone: m.tone, title: m.title, notes: m.notes || '' });
    setEditing(m);
  }

  async function save() {
    if (!form.title.trim() || !form.date) { setErr(t('needDateTitle')); return; }
    setBusy(true);
    setErr(null);
    try {
      const body = JSON.stringify({ date: form.date, kind: form.kind, tone: form.tone, title: form.title.trim(), notes: form.notes || null });
      const r = editing === 'new'
        ? await apiFetch('/api/gateway/milestones', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
        : await apiFetch(`/api/gateway/milestones/${(editing as Milestone).id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body });
      if (!r.ok) throw new Error(await r.text());
      setEditing(null);
      await load();
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(m: Milestone) {
    if (!window.confirm(t('confirmDelete', { title: m.title }))) return;
    const r = await apiFetch(`/api/gateway/milestones/${m.id}`, { method: 'DELETE' });
    if (r.ok) { setEditing(null); load(); } else setErr(await r.text());
  }

  async function attach(id: string, files: File[]) {
    if (!files.length) return;
    setBusy(true);
    setErr(null);
    try {
      for (const f of files) {
        const fd = new FormData();
        fd.set('file', f);
        const r = await apiFetch(`/api/gateway/milestones/${id}/attachments`, { method: 'POST', body: fd });
        if (!r.ok) throw new Error(errorRu(await r.json().catch(() => ({})), `HTTP ${r.status}`));
      }
      await load();
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }
  const [shown, setShown] = useState<{ sha: string; text: string; summary?: string | null } | null>(null);
  const [extracting, setExtracting] = useState<string | null>(null);
  async function extract(m: Milestone, a: Attachment, mode: 'text' | 'ocr' | 'llm' | 'summary') {
    setExtracting(a.sha256); setErr(null);
    try {
      const r = await apiFetch(`/api/gateway/milestones/${m.id}/attachments/${a.sha256}/extract?mode=${mode}`, { method: 'POST' });
      const j = await r.json();
      if (!r.ok) throw new Error(errorRu(j));
      setShown({ sha: a.sha256, text: j.extract.text, summary: j.extract.summary });
      await load();
    } catch (e: any) { setErr(String(e?.message || e)); } finally { setExtracting(null); }
  }
  async function showExtract(m: Milestone, a: Attachment) {
    if (shown?.sha === a.sha256) { setShown(null); return; }
    const r = await apiFetch(`/api/gateway/milestones/${m.id}/attachments/${a.sha256}/extract`);
    if (!r.ok) { setErr(errorRu(await r.json().catch(() => ({})))); return; }
    const x = (await r.json()).extract; setShown({ sha: a.sha256, text: x.text, summary: x.summary });
  }
  async function insertExtract(m: Milestone, a: Attachment, variant: 'full' | 'summary' = 'full') {
    const r = await apiFetch(`/api/gateway/milestones/${m.id}/attachments/${a.sha256}/extract/insert?variant=${variant}`, { method: 'POST' });
    if (!r.ok) { setErr(errorRu(await r.json().catch(() => ({})))); return; }
    setShown(null); await load();
  }
  async function removeFile(m: Milestone, a: Attachment) {
    const r = await apiFetch(`/api/gateway/milestones/${m.id}/attachments/${a.sha256}`, { method: 'DELETE' });
    if (r.ok) load();
  }
  async function openFile(a: Attachment) {
    const out = await openAttachment(a);
    if (!out.ok) setErr(await out.response.text());
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-header__title">{t('title')}</h1>
        <p className="page-header__desc">{t('desc')}</p>
      </div>
      {err && <div className="msg msg--error" style={{ marginBottom: 16 }}>{err}</div>}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
        <button type="button" className="btn btn--primary" onClick={openNew}><Icon name="plus" />{t('add')}</button>
        <FileButton className="btn btn--secondary" accept="application/pdf,image/*" multiple onFiles={setBatchFiles}><Icon name="upload" />{t('upload')}</FileButton>
      </div>
      <BatchUploadSheet files={batchFiles} onClose={() => setBatchFiles(null)} onDone={load} />

      {items === null && !err && <div className="skeleton" style={{ height: 120 }} />}
      {items?.length === 0 && (
        <EmptyState icon="doc" title={t('emptyTitle')} description={t('emptyDesc')} />
      )}

      <div className="ms-list">
        {items?.map((m) => {
          const k = KINDS.find((x) => x.key === m.kind) || KINDS.find((x) => x.key === 'other')!;
          return (
            <div key={m.id} id={m.id} className={`ms-item ms-item--${m.tone}`} style={{ scrollMarginTop: 16 }}>
              <div className="ms-item__rail"><span className="ms-item__dot" /></div>
              <div className="card ms-card">
                <div className="ms-card__head">
                  <div className="event-card__icon event-card__icon--other"><Icon name={k.icon} size={22} /></div>
                  <div className="event-card__body">
                    <div className="ms-card__date">{fmtDate(m.date)} · {t(`kindLabels.${k.key}`)}</div>
                    <div className="ms-card__title">{m.title}</div>
                  </div>
                  <span className={`pill ${m.tone === 'positive' ? 'ok' : m.tone === 'negative' ? 'pill--danger' : ''}`}>
                    {isTone(m.tone) ? t(`tones.${m.tone}`) : m.tone}
                  </span>
                </div>
                {m.notes && <div className="ms-card__notes">{m.notes}</div>}
                <div className="ms-card__files">
                  {m.attachments.map((a) => (
                    <span key={a.sha256} className="ms-file">
                      <button type="button" className="ms-file__open" onClick={() => openFile(a)}>
                        <Icon name={a.mimeType?.startsWith('image/') ? 'imaging' : 'doc'} size={18} />
                        {a.filename || a.sha256.slice(0, 10)}
                      </button>
                      <button type="button" className="ms-file__x" aria-label={t('card.removeFile')} onClick={() => removeFile(m, a)}><Icon name="close" size={16} /></button>
                    </span>
                  ))}
                  <FileButton className="btn btn--ghost btn--sm" accept="application/pdf,image/*" multiple disabled={busy} onFiles={(files) => attach(m.id, files)}><Icon name="upload" size={18} />{t('card.attach')}</FileButton>
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => openEdit(m)}>{t('card.edit')}</button>
                </div>
                {m.attachments.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                    {m.attachments.map((a) => (
                      <div key={a.sha256} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                          <span className="muted" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 260 }}>{a.filename || a.sha256.slice(0, 10)}:</span>
                          <span className="muted">{a.extract
                            ? (a.extract.method === 'llm' ? t('card.extractLlm', { k: Math.round(a.extract.chars / 1000) })
                              : a.extract.method === 'ocr' ? t('card.extractOcr', { k: Math.round(a.extract.chars / 1000) })
                                : t('card.extractPdf', { k: Math.round(a.extract.chars / 1000) }))
                            : a.mimeType === 'application/pdf' ? t('card.noExtractPdf') : t('card.noExtractImage')}</span>
                          {a.extract && <button type="button" className="note-tag" onClick={() => showExtract(m, a)}>{shown?.sha === a.sha256 ? t('card.hide') : t('card.show')}</button>}
                          {a.extract?.hasSummary && <button type="button" className="note-tag" onClick={() => insertExtract(m, a, 'summary')}>{t('card.toCommentSummary')}</button>}
                          {a.extract && <button type="button" className="note-tag" onClick={() => insertExtract(m, a, 'full')}>{t('card.toCommentFull')}</button>}
                          {!a.extract && <button type="button" className="note-tag" onClick={() => extract(m, a, 'ocr')} disabled={extracting === a.sha256} title={t('card.extractTextHint')}>{extracting === a.sha256 ? t('card.reading') : t('card.extractText')}</button>}
                          <button type="button" className="note-tag" onClick={() => extract(m, a, 'summary')} disabled={extracting === a.sha256} title={t('card.summaryHint')}>{extracting === a.sha256 ? t('card.thinking') : a.extract?.hasSummary ? t('card.summaryAgain') : t('card.summary')}</button>
                          <button type="button" className="note-tag" onClick={() => extract(m, a, 'llm')} disabled={extracting === a.sha256} title={t('card.llmHint')}>{extracting === a.sha256 ? t('card.thinking') : t('card.llm')}</button>
                        </div>
                        {shown?.sha === a.sha256 && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {shown.summary && <div className="ai-comment__text" style={{ fontSize: 13, background: 'var(--accent-soft)', padding: 10, borderRadius: 8 }}>{t.rich('card.summaryShown', { summary: shown.summary, b: (c) => <b>{c}</b> })}</div>}
                            <div className="ai-comment__text" style={{ fontSize: 13, maxHeight: 320, overflow: 'auto', background: 'var(--surface-2)', padding: 10, borderRadius: 8 }}>{shown.text}</div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <BottomSheet open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? t('sheet.newTitle') : t('sheet.editTitle')}>
        <div className="sheet__block">
          <div className="section-label">{t('sheet.kind')}</div>
          <div className="seg" style={{ flexWrap: 'wrap' }}>
            {KINDS.filter((k) => k.key !== 'ai_review').map((k) => (
              <button key={k.key} type="button" className={`seg__btn ${form.kind === k.key ? 'seg__btn--active' : ''}`} onClick={() => setForm({ ...form, kind: k.key })}>{t(`kinds.${k.key}`)}</button>
            ))}
          </div>
        </div>
        <div className="sheet__block">
          <div className="section-label">{t('sheet.tone')}</div>
          <div className="seg">
            {TONES.map((tone) => (
              <button key={tone} type="button" className={`seg__btn ${form.tone === tone ? `seg__btn--active ${tone === 'negative' ? 'seg__btn--warn' : ''}` : ''}`} onClick={() => setForm({ ...form, tone })}>{t(`tones.${tone}`)}</button>
            ))}
          </div>
        </div>
        <label className="field"><span>{t('sheet.date')}</span><input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label>
        <label className="field"><span>{t('sheet.name')}</span><input placeholder={t('sheet.namePlaceholder')} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
        <label className="field"><span>{t('sheet.notes')}</span><textarea rows={8} placeholder={t('sheet.notesPlaceholder')} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
        <button type="button" className="btn btn--primary btn--lg btn--block" onClick={save} disabled={busy}><Icon name="check" strokeWidth={2.2} />{busy ? t('sheet.saving') : t('sheet.save')}</button>
        {editing !== 'new' && editing && (
          <>
            <div className="muted" style={{ fontSize: 14 }}>{t('sheet.filesHint')}</div>
            <button type="button" className="btn btn--ghost" onClick={() => remove(editing as Milestone)}>{t('sheet.delete')}</button>
          </>
        )}
      </BottomSheet>
    </div>
  );
}
