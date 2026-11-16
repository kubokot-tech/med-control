'use client';

import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { useProtocolEdit } from './protocolEdit';

/** Settings → Protocol → Marker notes: text shown in a marker's card under the protocol's name. */
export default function ProtocolNotes() {
  const t = useTranslations('protocol');
  const { data, form, setForm, dirty, busy, msg, err, save, reset, catalogByKey } = useProtocolEdit();
  const [newKey, setNewKey] = useState('');
  if (!data || !form) return <div className="card meds-card"><div className="muted">{t('loading')}</div></div>;
  const keys = data.catalog.map((c) => c.key);
  const setNote = (k: string, text: string | null) => { const n = { ...form.markerNotes }; if (text == null) delete n[k]; else n[k] = text; setForm({ ...form, markerNotes: n }); };

  return (
    <>
      {Object.keys(form.markerNotes).length === 0 && <div className="muted">{t('notes.empty')}</div>}
      {Object.entries(form.markerNotes).map(([k, text]) => (
        <div key={k} className="field">
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <b style={{ flex: 1 }}>{catalogByKey.get(k)?.name || k}</b>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setNote(k, null)}>{t('notes.remove')}</button>
          </span>
          <textarea rows={3} value={text} onChange={(e) => setNote(k, e.target.value)} maxLength={600} />
        </div>
      ))}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={newKey} onChange={(e) => setNewKey(e.target.value)} style={{ height: 36, flex: '1 1 220px' }}>
          <option value="">{t('notes.pick')}</option>
          {keys.filter((k) => !(k in form.markerNotes)).map((k) => <option key={k} value={k}>{catalogByKey.get(k)?.name || k}</option>)}
        </select>
        <button type="button" className="btn btn--soft btn--sm" disabled={!newKey} onClick={() => { setNote(newKey, ''); setNewKey(''); }}>{t('notes.add')}</button>
      </div>
      {err && <div className="msg msg--error">{err}</div>}
      {msg && <div className="msg msg--ok">{msg}</div>}
      <div className="settings-savebar">
        <button type="button" className="btn btn--primary" onClick={() => save(t('notes.saved'))} disabled={busy || !dirty}>{t('save')}</button>
        {dirty && <button type="button" className="btn btn--ghost" onClick={reset} disabled={busy}>{t('cancelChanges')}</button>}
      </div>
    </>
  );
}
