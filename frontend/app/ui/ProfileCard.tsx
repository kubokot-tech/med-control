'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'use-intl';
import { apiFetch } from './labUtils';
import { errorRu } from './api';
import { useFormat } from './format';

type Version = { id: string; createdAt: string; source: string; note: string | null; chars: number; preview: string };
type VersionDetail = Version & { text: string; isCurrent: boolean; diff: { type: 'same' | 'add' | 'del'; text: string }[]; stats: { added: number; removed: number } };
/** Version sources with a name in `profileCard.source`. */
const SOURCE: Record<string, 'initial' | 'manual' | 'aiDraft' | 'restore'> = { initial: 'initial', manual: 'manual', ai_draft: 'aiDraft', restore: 'restore' };

/** Anamnesis text for the AI prompts plus a preview of everything the model receives. */
export default function ProfileCard() {
  const t = useTranslations('settings');
  const f = useFormat();
  const sourceName = (source: string) => (SOURCE[source] ? t(`profileCard.source.${SOURCE[source]}`) : source);
  const fmtWhen = (iso: string) => f.date(iso, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const [anamnesis, setAnamnesis] = useState('');
  const [saved, setSaved] = useState('');
  // the AI draft needs a configured AI service; without one the button is off with a hint
  const [aiOn, setAiOn] = useState(true);
  useEffect(() => { apiFetch('/api/gateway/ai/status').then(async (r) => { if (r.ok) setAiOn(Boolean((await r.json()).enabled)); }); }, []);
  const [profile, setProfile] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ text: string; model: string; truncated?: boolean } | null>(null);
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [view, setView] = useState<VersionDetail | null>(null);

  const load = useCallback(async () => {
    const r = await apiFetch('/api/gateway/ai/profile');
    if (r.ok) { const j = await r.json(); setAnamnesis(j.anamnesis || ''); setSaved(j.anamnesis || ''); setProfile(j.profile || ''); }
    const v = await apiFetch('/api/gateway/ai/anamnesis/versions');
    if (v.ok) setVersions((await v.json()).versions || []);
  }, []);
  async function openVersion(id: string) {
    setErr(null);
    const r = await apiFetch(`/api/gateway/ai/anamnesis/versions/${id}`);
    if (!r.ok) { setErr(errorRu(await r.json().catch(() => ({})))); return; }
    setView(await r.json());
  }
  async function restore(v: VersionDetail) {
    if (!confirm(t('profileCard.restoreConfirm', { date: fmtWhen(v.createdAt) }))) return;
    setBusy(true); setErr(null);
    try {
      const r = await apiFetch(`/api/gateway/ai/anamnesis/versions/${v.id}/restore`, { method: 'POST' });
      if (!r.ok) throw new Error(errorRu(await r.json().catch(() => ({}))));
      setView(null); setMsg(t('profileCard.restored')); await load();
    } catch (e: any) { setErr(String(e?.message || e)); } finally { setBusy(false); }
  }
  useEffect(() => { load(); }, [load]);

  async function save() {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await apiFetch('/api/gateway/ai/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ anamnesis }) });
      if (!r.ok) throw new Error((await r.json()).error);
      setSaved(anamnesis); setMsg(t('profileCard.saved')); await load();
    } catch (e: any) { setErr(String(e?.message || e)); } finally { setBusy(false); }
  }

  async function makeDraft() {
    setBusy(true); setErr(null); setMsg(null); setDraft(null);
    try {
      const r = await apiFetch('/api/gateway/ai/anamnesis/draft', { method: 'POST' });
      const j = await r.json();
      if (!r.ok) throw new Error(errorRu(j));
      setDraft({ text: j.draft, model: j.model, truncated: j.truncated });
    } catch (e: any) { setErr(t('profileCard.failed', { error: String(e?.message || e) })); } finally { setBusy(false); }
  }
  async function acceptDraft() {
    if (!draft) return;
    setAnamnesis(draft.text);
    setBusy(true); setErr(null);
    try {
      const r = await apiFetch('/api/gateway/ai/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ anamnesis: draft.text, source: 'ai_draft' }) });
      if (!r.ok) throw new Error((await r.json()).error);
      setSaved(draft.text); setDraft(null); setMsg(t('profileCard.updatedFromHistory')); await load();
    } catch (e: any) { setErr(String(e?.message || e)); } finally { setBusy(false); }
  }

  return (
    <div className="card meds-card">
      <div className="card__title">{t('profileCard.title')}</div>
      <div className="muted" style={{ fontSize: 14, lineHeight: 1.5 }}>
        {t('profileCard.intro')}
      </div>
      <div className="field">
        <label htmlFor="anamnesis">{t('profileCard.anamnesis')}</label>
        <textarea id="anamnesis" rows={8} value={anamnesis} onChange={(e) => setAnamnesis(e.target.value)} maxLength={20000} placeholder={t('profileCard.placeholder')} />
      </div>
      {err && <div className="msg msg--error">{err}</div>}
      {msg && <div className="msg msg--ok">{msg}</div>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn--primary btn--sm" onClick={save} disabled={busy || anamnesis === saved}>{t('profileCard.save')}</button>
        <button type="button" className="btn btn--soft btn--sm" onClick={makeDraft} disabled={busy || !aiOn} title={aiOn ? undefined : t('profileCard.needsAi')}>{busy && !draft ? t('profileCard.collecting') : saved.trim() ? t('profileCard.updateFromHistory') : t('profileCard.makeDraft')}</button>
      </div>
      {draft && (
        <div className="card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10, background: 'var(--surface-2)' }}>
          <div style={{ fontWeight: 600 }}>{t('profileCard.draftFrom', { model: draft.model })}</div>
          <div className="muted" style={{ fontSize: 13 }}>{t('profileCard.draftHint')}</div>
          {draft.truncated && <div className="msg msg--error">{t('profileCard.truncated')}</div>}
          <textarea rows={14} value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn--primary btn--sm" onClick={acceptDraft} disabled={busy}>{t('profileCard.accept')}</button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setDraft(null)} disabled={busy}>{t('profileCard.reject')}</button>
          </div>
        </div>
      )}
      {versions && versions.length > 0 && (
        <details open={view !== null}>
          <summary className="muted" style={{ cursor: 'pointer', fontSize: 14 }}>{t('profileCard.versions', { n: versions.length })}</summary>
          <div className="sheet__list" style={{ marginTop: 8 }}>
            {versions.slice(0, 12).map((v, i) => (
              <div key={v.id} className="list-row">
                <span style={{ minWidth: 0 }}>
                  <b>{fmtWhen(v.createdAt)}</b> · {sourceName(v.source)}{i === 0 ? ` · ${t('profileCard.current')}` : ''}{v.note ? ` · ${v.note}` : ''}
                  <br /><span className="muted" style={{ fontSize: 13 }}>{t('profileCard.chars', { n: v.chars })} · {v.preview}</span>
                </span>
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => openVersion(v.id)}>{i === 0 ? t('profileCard.open') : t('profileCard.compare')}</button>
              </div>
            ))}
          </div>
          {view && (
            <div className="card" style={{ padding: 12, marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--surface-2)' }}>
              <div style={{ fontWeight: 600 }}>{t('profileCard.versionFrom', { date: fmtWhen(view.createdAt), source: sourceName(view.source) })}</div>
              {view.isCurrent ? <div className="muted" style={{ fontSize: 13 }}>{t('profileCard.sameAsCurrent')}</div>
                : <div className="muted" style={{ fontSize: 13 }}>{t('profileCard.diffHint', { added: view.stats.added, removed: view.stats.removed })}</div>}
              <div style={{ fontSize: 13, lineHeight: 1.5, maxHeight: 360, overflow: 'auto', fontFamily: 'inherit', whiteSpace: 'pre-wrap' }}>
                {view.diff.map((d, i) => (
                  <div key={i} style={{ padding: '1px 6px', borderRadius: 4, background: d.type === 'add' ? 'var(--accent-soft)' : d.type === 'del' ? 'rgba(139,46,46,.12)' : 'transparent', color: d.type === 'del' ? 'var(--danger, #8b2e2e)' : 'inherit', textDecoration: d.type === 'del' ? 'line-through' : 'none' }}>
                    {d.type === 'add' ? '+ ' : d.type === 'del' ? '− ' : '  '}{d.text || '\u00a0'}
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {!view.isCurrent && <button type="button" className="btn btn--secondary btn--sm" onClick={() => restore(view)} disabled={busy}>{t('profileCard.restore')}</button>}
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => setView(null)}>{t('profileCard.close')}</button>
              </div>
            </div>
          )}
        </details>
      )}
      {profile !== null && (
        <details>
          <summary className="muted" style={{ cursor: 'pointer', fontSize: 14 }}>{t('profileCard.modelSees')}</summary>
          <div className="ai-comment__text" style={{ fontSize: 13, marginTop: 8 }}>{profile || t('profileCard.modelSeesEmpty')}</div>
        </details>
      )}
    </div>
  );
}
