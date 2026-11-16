'use client';

import { useTranslations } from 'use-intl';
import { useProtocolEdit } from './protocolEdit';

/** Settings → Protocol → Name and texts for AI: name, the AI introduction, the lab cadence hint. */
export default function ProtocolTexts() {
  const t = useTranslations('protocol');
  const { form, setForm, dirty, busy, msg, err, save, reset } = useProtocolEdit();
  if (!form) return <div className="card meds-card"><div className="muted">{t('loading')}</div></div>;
  return (
    <>
      <div className="field"><label htmlFor="proto-name">{t('texts.name')}</label><input id="proto-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={120} placeholder={t('texts.namePlaceholder')} /></div>
      <div className="field">
        <label htmlFor="proto-ai">{t('texts.ai')}</label>
        <textarea id="proto-ai" rows={6} value={form.aiNotes} onChange={(e) => setForm({ ...form, aiNotes: e.target.value })} maxLength={4000} placeholder={t('texts.aiPlaceholder')} />
        <span className="muted" style={{ fontSize: 12 }}>{t('texts.aiHint')}</span>
      </div>
      <div className="field">
        <label htmlFor="proto-cad">{t('texts.cadence')}</label>
        <input id="proto-cad" value={form.labCadenceHint} onChange={(e) => setForm({ ...form, labCadenceHint: e.target.value })} maxLength={300} placeholder={t('texts.cadencePlaceholder')} />
        <span className="muted" style={{ fontSize: 12 }}>{t('texts.cadenceHint')}</span>
      </div>
      {err && <div className="msg msg--error">{err}</div>}
      {msg && <div className="msg msg--ok">{msg}</div>}
      <div className="settings-savebar">
        <button type="button" className="btn btn--primary" onClick={() => save(t('saved'))} disabled={busy || !dirty || !form.name.trim()}>{t('save')}</button>
        {dirty && <button type="button" className="btn btn--ghost" onClick={reset} disabled={busy}>{t('cancelChanges')}</button>}
      </div>
    </>
  );
}
