'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'use-intl';
import { apiJson, errorRu } from './api';
import { useFormat } from './format';
import { refText } from './labUtils';
import RefSheet, { builtInFor, type RefSettings } from './RefSheet';

/** Settings → "Lab reference ranges": the patient's sex for the built-in ranges and every marker's range in force. */
export default function RefsCard() {
  const f = useFormat();
  const t = useTranslations('labs');
  const [data, setData] = useState<RefSettings | null>(null);
  const [all, setAll] = useState(false);
  const [edit, setEdit] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => { apiJson<RefSettings>('/api/gateway/labs/refs').then(setData).catch((e) => setErr(errorRu(e))); }, []);
  useEffect(load, [load]);

  async function saveSex(sex: string) {
    setErr(null);
    try { await apiJson('/api/gateway/labs/refs', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sex: sex || null }) }); load(); }
    catch (e) { setErr(errorRu(e)); }
  }

  const own = data?.items.filter((x) => x.override) || [];
  const shown = all ? data?.items || [] : own;
  const describe = (it: RefSettings['items'][number]) => {
    const range = `${refText(f, it.inForce.low, it.inForce.high)}${it.unit ? ` ${it.unit}` : ''}`;
    if (it.override?.mode === 'custom') return `${range} · ${t('refSource.user')}`;
    if (it.override?.mode === 'lab') return t('refs.labChosen');
    if (it.inForce.source === 'catalog') return `${range} · ${t('refSource.catalog')}`;
    return it.builtIn && !builtInFor(it, data!.sex).range ? t('refs.labNoSex') : t('refs.labNotInCatalog');
  };

  return (
    <div className="card meds-card">
      <div className="card__title">{t('refs.title')}</div>
      <div className="muted" style={{ fontSize: 14, lineHeight: 1.5 }}>
        {t('refs.desc')}
      </div>
      {data && (
        <>
          <label className="field">
            <span>{t('refs.sex')}</span>
            <select value={data.sex || ''} onChange={(e) => saveSex(e.target.value)} style={{ height: 36 }}>
              <option value="">{t('refs.sexNone')}</option>
              <option value="f">{t('refs.sexF')}</option>
              <option value="m">{t('refs.sexM')}</option>
            </select>
            <span className="muted" style={{ fontSize: 12 }}>{t('refs.sexHint')}</span>
          </label>
          <div className="section-label">{all ? t('refs.allCount', { n: data.items.length }) : own.length ? t('refs.ownCount', { n: own.length }) : t('refs.noOwn')}</div>
          {shown.length > 0 && (
            <div className="sheet__list">
              {shown.map((it) => (
                <div key={it.key} className="list-row">
                  <span style={{ minWidth: 0 }}>
                    <b>{it.short || it.key}</b>{it.category === 'urine' ? <span className="muted"> {t('refs.urine')}</span> : null}
                    <br /><span className="muted" style={{ fontSize: 13 }}>{describe(it)}</span>
                  </span>
                  <button type="button" className="btn btn--ghost btn--sm" style={{ marginLeft: 'auto' }} onClick={() => setEdit(it.key)}>{t('refs.edit')}</button>
                </div>
              ))}
            </div>
          )}
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => setAll(!all)}>{all ? t('refs.showOwn') : t('refs.showAll')}</button>
        </>
      )}
      {err && <div className="msg msg--error">{err}</div>}
      {edit && <RefSheet open={edit !== null} onClose={() => setEdit(null)} testKey={edit} onSaved={load} />}
    </div>
  );
}
