'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'use-intl';
import Icon from '../ui/icons';
import { apiFetch } from '../ui/labUtils';
import { errorRu } from '../ui/api';
import { useFormat } from '../ui/format';
import EmptyState from '../ui/EmptyState';

type Note = { id: string; title: string; tags: string[]; url: string | null; source: string; sourceName: string | null; pinned: boolean; updatedAt: string; excerpt: string; filesCount?: number };
type Tag = { tag: string; n: number };


export default function NotesPage() {
  const t = useTranslations('notes.list');
  const f = useFormat();
  const fmtWhen = (iso: string) => f.date(iso, { day: 'numeric', month: 'short', year: 'numeric' });
  const router = useRouter();
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [q, setQ] = useState('');
  const [tag, setTag] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setErr(null);
    const r = await apiFetch(`/api/gateway/notes?q=${encodeURIComponent(q)}&tag=${encodeURIComponent(tag)}`);
    if (!r.ok) { setErr(errorRu(await r.json().catch(() => ({})))); return; }
    const j = await r.json();
    setNotes(j.notes); setTags(j.tags);
  }, [q, tag]);
  useEffect(() => { const t = setTimeout(load, q ? 250 : 0); return () => clearTimeout(t); }, [load, q]);

  async function createNew() {
    setBusy(true); setErr(null);
    try {
      const r = await apiFetch('/api/gateway/notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: t('newNoteTitle'), body: '', tags: tag ? [tag] : [] }) });
      const j = await r.json();
      if (!r.ok) throw new Error(errorRu(j));
      router.push(`/notes/${j.note.id}?edit=1`);
    } catch (e: any) { setErr(String(e?.message || e)); } finally { setBusy(false); }
  }
  async function importFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true); setErr(null); setMsg(null);
    try {
      const fd = new FormData();
      for (const f of Array.from(files)) fd.append('files', f, f.name);
      const r = await apiFetch('/api/gateway/notes/import', { method: 'POST', body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(errorRu(j));
      setMsg(j.skipped.length
        ? t('importedSkipped', { n: j.created.length, names: j.skipped.map((s: any) => s.name).join(', ') })
        : t('imported', { n: j.created.length }));
      await load();
    } catch (e: any) { setErr(String(e?.message || e)); } finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-header__title">{t('title')}</h1>
        <p className="page-header__desc">{t('desc')}</p>
      </div>
      {err && <div className="msg msg--error" style={{ marginBottom: 16 }}>{err}</div>}
      {msg && <div className="msg msg--ok" style={{ marginBottom: 16 }}>{msg}</div>}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <button type="button" className="btn btn--primary" onClick={createNew} disabled={busy}><Icon name="plus" size={18} />{t('newNote')}</button>
        <button type="button" className="btn btn--secondary" onClick={() => fileRef.current?.click()} disabled={busy}><Icon name="upload" />{t('import')}</button>
        <input ref={fileRef} type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" multiple hidden onChange={(e) => importFiles(e.target.files)} />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('searchPlaceholder')} style={{ flex: 1, minWidth: 180 }} />
      </div>
      {tags.length > 0 && (
        <div className="note-tags" style={{ marginBottom: 16 }}>
          {tags.map((x) => <button key={x.tag} type="button" className={`note-tag ${tag === x.tag ? 'note-tag--active' : ''}`} onClick={() => setTag(tag === x.tag ? '' : x.tag)}>#{x.tag} · {x.n}</button>)}
        </div>
      )}

      {notes === null && !err && <div className="skeleton" style={{ height: 120 }} />}
      {notes?.length === 0 && (
        <EmptyState icon="doc" title={q || tag ? t('notFoundTitle') : t('emptyTitle')} description={q || tag ? t('notFoundDesc') : t('emptyDesc')} />
      )}
      <div className="today-section">
        {notes?.map((n) => (
          <Link key={n.id} href={`/notes/${n.id}`} className="card meds-card" style={{ gap: 6, textDecoration: 'none', color: 'inherit' }}>
            <div className="ms-card__head">
              <div className="event-card__icon event-card__icon--other"><Icon name="doc" size={22} /></div>
              <div className="event-card__body">
                <div className="ms-card__date">{n.pinned ? '📌 ' : ''}{fmtWhen(n.updatedAt)}{n.source === 'import' ? ` · ${n.sourceName ? t('sourceNamed', { name: n.sourceName }) : t('source')}` : ''}{n.filesCount ? ` · ${t('files', { n: n.filesCount })}` : ''}</div>
                <div className="ms-card__title">{n.title}</div>
              </div>
              <Icon name="chevron" size={20} className="event-card__chevron" />
            </div>
            {n.excerpt && <div className="ms-card__notes">{n.excerpt}</div>}
            {(n.tags.length > 0 || n.url) && <div className="muted" style={{ fontSize: 13 }}>{n.tags.map((t) => `#${t}`).join(' ')}{n.url ? ` · ${n.url.replace(/^https?:\/\//, '').slice(0, 60)}` : ''}</div>}
          </Link>
        ))}
      </div>
    </div>
  );
}
