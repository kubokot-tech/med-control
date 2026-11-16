'use client';

import { useTranslations } from 'use-intl';
import { useProtocolEdit } from './protocolEdit';

/** Settings → Protocol → Diary scales: which 0–3 scales the diary shows, the switched-on ones first. */
export default function ProtocolScales() {
  const t = useTranslations('protocol');
  const { data, form, setForm, dirty, busy, msg, err, save, reset } = useProtocolEdit();
  if (!data || !form) return <div className="card meds-card"><div className="muted">{t('loading')}</div></div>;
  const all = data.scaleCatalog || [];
  // the order stays as loaded while ticking, so rows do not jump under the finger
  const savedOn = new Set(data.protocol.diaryScales);
  const ordered = [...all.filter((s) => savedOn.has(s.key)), ...all.filter((s) => !savedOn.has(s.key))];
  const toggle = (k: string) => setForm({ ...form, diaryScales: form.diaryScales.includes(k) ? form.diaryScales.filter((x) => x !== k) : [...form.diaryScales, k] });

  return (
    <>
      <div className="sheet__list">
        {ordered.map((sc) => (
          <label key={sc.key} className="choice-row">
            <input type="checkbox" checked={form.diaryScales.includes(sc.key)} onChange={() => toggle(sc.key)} />
            <span>{sc.label}{sc.hint && <><br /><span className="muted" style={{ fontSize: 13 }}>{sc.hint}</span></>}</span>
          </label>
        ))}
      </div>
      {err && <div className="msg msg--error">{err}</div>}
      {msg && <div className="msg msg--ok">{msg}</div>}
      <div className="settings-savebar">
        <button type="button" className="btn btn--primary" onClick={() => save(t('scales.saved'))} disabled={busy || !dirty}>{t('save')}</button>
        {dirty && <button type="button" className="btn btn--ghost" onClick={reset} disabled={busy}>{t('cancelChanges')}</button>}
      </div>
    </>
  );
}
