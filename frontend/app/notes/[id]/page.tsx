'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'use-intl';
import Icon from '../../ui/icons';
import { apiFetch, openAttachment } from '../../ui/labUtils';
import { errorRu } from '../../ui/api';
import Markdown from '../../ui/Markdown';
import AiComment from '../../ui/AiComment';
import { useFormat } from '../../ui/format';
import { useRecordId } from '../../ui/recordLink';
import FileButton from '../../ui/FileButton';

type Extract = { sha256: string; method: 'pdf_text' | 'llm' | 'ocr'; model: string | null; chars: number; createdAt: string; hasSummary?: boolean; summaryModel?: string | null };
type NoteFile = { sha256: string; filename: string | null; mimeType: string; createdAt: string; extract?: Extract | null };
type Note = { id: string; title: string; body: string; tags: string[]; url: string | null; source: string; sourceName: string | null; pinned: boolean; createdAt: string; updatedAt: string; files: NoteFile[] };


export default function NotePage() {
  const t = useTranslations('notes.note');
  const f = useFormat();
  const fmtWhen = (iso: string) => f.date(iso, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const id = useRecordId();
  const sp = useSearchParams();
  const router = useRouter();
  const [note, setNote] = useState<Note | null>(null);
  const [edit, setEdit] = useState(sp.get('edit') === '1');
  const [form, setForm] = useState({ title: '', body: '', tags: '', url: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [shown, setShown] = useState<{ sha: string; text: string; summary?: string | null } | null>(null);
  const [extracting, setExtracting] = useState<string | null>(null);

  async function extract(f: NoteFile, mode: 'auto' | 'text' | 'ocr' | 'llm' | 'summary') {
    setExtracting(f.sha256); setErr(null);
    try {
      const r = await apiFetch(`/api/gateway/notes/${id}/files/${f.sha256}/extract?mode=${mode}`, { method: 'POST' });
      const j = await r.json();
      if (!r.ok) throw new Error(errorRu(j));
      setShown({ sha: f.sha256, text: j.extract.text, summary: j.extract.summary });
      await load();
    } catch (e: any) { setErr(String(e?.message || e)); } finally { setExtracting(null); }
  }
  async function showExtract(f: NoteFile) {
    if (shown?.sha === f.sha256) { setShown(null); return; }
    const r = await apiFetch(`/api/gateway/notes/${id}/files/${f.sha256}/extract`);
    if (!r.ok) { setErr(errorRu(await r.json().catch(() => ({})))); return; }
    const x = (await r.json()).extract; setShown({ sha: f.sha256, text: x.text, summary: x.summary });
  }
  async function insertExtract(f: NoteFile, variant: 'full' | 'summary' = 'full') {
    setBusy(true); setErr(null);
    try {
      const r = await apiFetch(`/api/gateway/notes/${id}/files/${f.sha256}/extract/insert?variant=${variant}`, { method: 'POST' });
      const j = await r.json();
      if (!r.ok) throw new Error(errorRu(j));
      setNote(j.note); setShown(null);
    } catch (e: any) { setErr(String(e?.message || e)); } finally { setBusy(false); }
  }

  const load = useCallback(async () => {
    if (!id) return;
    const r = await apiFetch(`/api/gateway/notes/${id}`);
    if (!r.ok) { setErr(errorRu(await r.json().catch(() => ({})))); return; }
    const n: Note = await r.json();
    setNote(n);
    setForm({ title: n.title, body: n.body, tags: n.tags.join(', '), url: n.url || '' });
  }, [id]);
  useEffect(() => { load(); }, [load]);

  async function save() {
    setBusy(true); setErr(null);
    try {
      const r = await apiFetch(`/api/gateway/notes/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: form.title, body: form.body, tags: form.tags.split(/[,;]/).map((t) => t.trim()).filter(Boolean), url: form.url || null }) });
      const j = await r.json();
      if (!r.ok) throw new Error(errorRu(j));
      setNote(j.note); setEdit(false);
    } catch (e: any) { setErr(String(e?.message || e)); } finally { setBusy(false); }
  }
  async function togglePin() {
    if (!note) return;
    const r = await apiFetch(`/api/gateway/notes/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pinned: !note.pinned }) });
    if (r.ok) setNote((await r.json()).note);
  }
  async function remove() {
    if (!confirm(t('confirmDelete'))) return;
    const r = await apiFetch(`/api/gateway/notes/${id}`, { method: 'DELETE' });
    if (r.ok) router.push('/notes'); else setErr(errorRu(await r.json().catch(() => ({}))));
  }
  async function upload(files: File[]) {
    if (!files.length) return;
    setBusy(true); setErr(null);
    try {
      const fd = new FormData();
      for (const f of Array.from(files)) fd.append('file', f, f.name);
      const r = await apiFetch(`/api/gateway/notes/${id}/files`, { method: 'POST', body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(errorRu(j));
      await load();
    } catch (e: any) { setErr(String(e?.message || e)); } finally { setBusy(false); }
  }
  async function removeFile(f: NoteFile) {
    const r = await apiFetch(`/api/gateway/notes/${id}/files/${f.sha256}`, { method: 'DELETE' });
    if (r.ok) load();
  }
  async function openFile(f: NoteFile) {
    await openAttachment(f);
  }
  function insertImage(f: NoteFile) {
    const snippet = `\n![${f.filename || t('imageAlt')}](dtc://${f.sha256})\n`;
    const ta = bodyRef.current;
    if (ta) {
      const pos = ta.selectionStart ?? form.body.length;
      setForm({ ...form, body: form.body.slice(0, pos) + snippet + form.body.slice(pos) });
    } else setForm({ ...form, body: form.body + snippet });
  }

  if (!note) return <div className="page-container">{err ? <div className="msg msg--error">{err}</div> : <div className="skeleton" style={{ height: 160 }} />}</div>;
  return (
    <div className="page-container">
      <div style={{ marginBottom: 10 }}><Link href="/notes" className="btn btn--ghost btn--sm"><Icon name="back" />{t('back')}</Link></div>
      {err && <div className="msg msg--error" style={{ marginBottom: 16 }}>{err}</div>}

      {edit ? (
        <div className="card meds-card" style={{ marginBottom: 16 }}>
          <label className="field"><span>{t('titleLabel')}</span><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={200} /></label>
          <label className="field"><span>{t('bodyLabel')}</span><textarea ref={bodyRef} rows={18} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 14 }} /></label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <label className="field"><span>{t('tagsLabel')}</span><input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder={t('tagsPlaceholder')} /></label>
            <label className="field"><span>{t('urlLabel')}</span><input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://…" /></label>
          </div>
          {note.files.some((f) => f.mimeType.startsWith('image/')) && (
            <div className="muted" style={{ fontSize: 13 }}>{t('insertImage')} {note.files.filter((f) => f.mimeType.startsWith('image/')).map((f) => <button key={f.sha256} type="button" className="note-tag" onClick={() => insertImage(f)} style={{ marginRight: 6 }}>{f.filename || f.sha256.slice(0, 8)}</button>)}</div>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn--primary" onClick={save} disabled={busy}><Icon name="check" strokeWidth={2.2} />{t('save')}</button>
            <button type="button" className="btn btn--ghost" onClick={() => { setEdit(false); setForm({ title: note.title, body: note.body, tags: note.tags.join(', '), url: note.url || '' }); }} disabled={busy}>{t('cancel')}</button>
          </div>
        </div>
      ) : (
        <div className="card meds-card" style={{ marginBottom: 16 }}>
          <div className="meds-card__row" style={{ alignItems: 'flex-start' }}>
            <div>
              <div className="card__title" style={{ fontSize: 22 }}>{note.pinned ? '📌 ' : ''}{note.title}</div>
              <div className="muted" style={{ fontSize: 13 }}>{fmtWhen(note.updatedAt)}{note.source === 'import' ? ` · ${note.sourceName ? t('sourceNamed', { name: note.sourceName }) : t('source')}` : ''}</div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => setEdit(true)}>{t('edit')}</button>
              <button type="button" className="btn btn--ghost btn--sm" onClick={togglePin}>{note.pinned ? t('unpin') : t('pin')}</button>
            </div>
          </div>
          {(note.tags.length > 0 || note.url) && (
            <div className="muted" style={{ fontSize: 14 }}>
              {note.tags.length > 0 && <span className="note-tags" style={{ display: 'inline-flex', marginRight: 8 }}>{note.tags.map((t) => <Link key={t} href={`/notes?tag=${encodeURIComponent(t)}`} className="note-tag">#{t}</Link>)}</span>}
              {note.url && /^https?:\/\//i.test(note.url) && <a href={note.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>{note.url.replace(/^https?:\/\//, '').slice(0, 80)}</a>}
            </div>
          )}
          {note.body ? <Markdown text={note.body} /> : <div className="muted">{t('noBody')}</div>}
        </div>
      )}

      <div className="card meds-card" style={{ marginBottom: 16 }}>
        <div className="meds-card__row">
          <div className="card__title">{t('files')}</div>
          <FileButton className="btn btn--secondary btn--sm" accept="image/*,application/pdf" multiple disabled={busy} onFiles={upload}><Icon name="upload" />{t('addFile')}</FileButton>
        </div>
        {note.files.length === 0 && <div className="muted" style={{ fontSize: 14 }}>{t('filesHint')}</div>}
        {note.files.length > 0 && (
          <div className="sheet__list">
            {note.files.map((f) => (
              <div key={f.sha256} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                <div className="list-row" style={{ padding: 0, border: 0 }}>
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => openFile(f)} style={{ minWidth: 0, justifyContent: 'flex-start' }}><Icon name="doc" size={18} />{f.filename || f.sha256.slice(0, 12)}</button>
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => removeFile(f)}>{t('removeFile')}</button>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', fontSize: 13 }}>
                  <span className="muted">{f.extract
                    ? (f.extract.method === 'llm'
                      ? (f.extract.model ? t('extractLlmModel', { k: Math.round(f.extract.chars / 1000), model: f.extract.model }) : t('extractLlm', { k: Math.round(f.extract.chars / 1000) }))
                      : f.extract.method === 'ocr' ? t('extractOcr', { k: Math.round(f.extract.chars / 1000) }) : t('extractPdf', { k: Math.round(f.extract.chars / 1000) }))
                    : f.mimeType === 'application/pdf' ? t('noExtractPdf') : t('noExtractImage')}</span>
                  {f.extract && <button type="button" className="note-tag" onClick={() => showExtract(f)}>{shown?.sha === f.sha256 ? t('hide') : t('show')}</button>}
                  {f.extract?.hasSummary && <button type="button" className="note-tag" onClick={() => insertExtract(f, 'summary')} disabled={busy}>{t('insertSummary')}</button>}
                  {f.extract && <button type="button" className="note-tag" onClick={() => insertExtract(f, 'full')} disabled={busy}>{t('insertFull')}</button>}
                  {!f.extract && <button type="button" className="note-tag" onClick={() => extract(f, 'ocr')} disabled={extracting === f.sha256} title={t('extractTextHint')}>{extracting === f.sha256 ? t('reading') : t('extractText')}</button>}
                  <button type="button" className="note-tag" onClick={() => extract(f, 'summary')} disabled={extracting === f.sha256} title={t('summaryHint')}>{extracting === f.sha256 ? t('thinking') : f.extract?.hasSummary ? t('summaryAgain') : t('summary')}</button>
                  <button type="button" className="note-tag" onClick={() => extract(f, 'llm')} disabled={extracting === f.sha256} title={t('llmHint')}>{extracting === f.sha256 ? t('thinking') : t('llm')}</button>
                </div>
                {shown?.sha === f.sha256 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {shown.summary && <div className="ai-comment__text" style={{ fontSize: 13, background: 'var(--accent-soft)', padding: 10, borderRadius: 8 }}>{t.rich('summaryShown', { summary: shown.summary, b: (c) => <b>{c}</b> })}</div>}
                    <div className="ai-comment__text" style={{ fontSize: 13, maxHeight: 320, overflow: 'auto', background: 'var(--surface-2)', padding: 10, borderRadius: 8 }}>{shown.text}</div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <AiComment subjectType="note" subjectId={id} />

      <div style={{ marginTop: 16 }}><button type="button" className="btn btn--ghost btn--sm" onClick={remove}>{t('delete')}</button></div>
    </div>
  );
}
