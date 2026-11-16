'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'use-intl';
import Icon from './icons';
import BottomSheet from './BottomSheet';
import { apiFetch } from './labUtils';
import { errorRu } from './api';
import { useProtocolEdit } from './protocolEdit';

/**
 * Settings → Treatment protocol: what the protocol is, Change protocol (a sheet with the presets, then the one-off
 * follow-ups: regimen and infusion catalog), and a row per part, each on its own page.
 */
export default function ProtocolOverview() {
  const t = useTranslations('protocol');
  const { data, form, busy, setBusy, msg, setMsg, err, setErr, reload } = useProtocolEdit();
  const [sheet, setSheet] = useState(false);
  const [pick, setPick] = useState('');
  const [loaded, setLoaded] = useState<string | null>(null); // preset just loaded: the sheet then offers the follow-ups
  const [followMsg, setFollowMsg] = useState<string | null>(null);

  if (!data || !form) return <div className="card meds-card"><div className="muted">{t('loading')}</div></div>;
  const pillClass = form.status === 'ready' ? 'pill ok' : form.status === 'example' ? 'pill--warning pill' : 'pill pill--info';
  const total = data.scaleCatalog?.length || 0;

  async function loadPreset() {
    if (!pick) return;
    setBusy(true); setErr(null); setMsg(null); setFollowMsg(null);
    try {
      const r = await apiFetch('/api/gateway/protocol/preset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preset: pick }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(errorRu(j));
      setLoaded(j.protocol.name);
      await reload();
    } catch (e: any) { setErr(String(e?.message || e)); } finally { setBusy(false); }
  }
  async function apply(what: 'regimen' | 'agents') {
    setBusy(true); setErr(null); setFollowMsg(null);
    try {
      const r = await apiFetch('/api/gateway/protocol/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [what]: true }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(errorRu(j));
      if (what === 'regimen') setFollowMsg(j.regimen === 'created' ? t('overview.regimenCreated') : j.regimen === 'exists' ? t('overview.regimenExists') : t('overview.regimenNone'));
      else setFollowMsg(j.agentsAdded ? t('overview.agentsAdded', { n: j.agentsAdded }) : t('overview.agentsNone'));
    } catch (e: any) { setErr(String(e?.message || e)); } finally { setBusy(false); }
  }
  const closeSheet = () => { setSheet(false); setPick(''); if (loaded) setMsg(t('overview.loadedMsg', { name: loaded })); setLoaded(null); setFollowMsg(null); };

  const followUps = (
    <>
      {form.regimen && <button type="button" className="btn btn--soft btn--sm" onClick={() => apply('regimen')} disabled={busy}>{t('overview.createRegimen', { regimen: `${form.regimen.name}${form.regimen.doseValue != null ? ` ${form.regimen.doseValue} ${form.regimen.doseUnit || ''}` : ''}` })}</button>}
      {form.infusionAgents.length > 0 && <button type="button" className="btn btn--soft btn--sm" onClick={() => apply('agents')} disabled={busy}>{t('overview.addAgents', { names: form.infusionAgents.map((a) => a.shortName || a.name).join(', ') })}</button>}
    </>
  );

  const rows: { href: string; title: string; sub: string }[] = [
    { href: '/settings/protocol/alerts', title: t('overview.rows.alerts'), sub: t('overview.rows.alertsSub', { n: form.labRules.length }) },
    { href: '/settings/protocol/scales', title: t('overview.rows.scales'), sub: t('overview.rows.scalesSub', { on: form.diaryScales.length, total }) },
    { href: '/settings/protocol/notes', title: t('overview.rows.notes'), sub: t('overview.rows.notesSub', { n: Object.keys(form.markerNotes).length }) },
    { href: '/settings/protocol/texts', title: t('overview.rows.texts'), sub: form.aiNotes.trim() ? t('overview.rows.aiFilled') : t('overview.rows.aiEmpty') },
  ];

  return (
    <>
      <div className="card meds-card">
        <div className="meds-card__row">
          <div className="card__title">{form.name || t('overview.untitled')}</div>
          <span className={pillClass}>{t(`status.${form.status}`)}</span>
        </div>
        <div className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>{t('overview.presetsWarning')}</div>
        <div><button type="button" className="btn btn--secondary btn--sm" onClick={() => setSheet(true)}>{t('overview.change')}</button></div>
        {msg && <div className="msg msg--ok">{msg}</div>}
        {err && !sheet && <div className="msg msg--error">{err}</div>}
      </div>

      <div className="sheet__list">
        {rows.map((r) => (
          <Link key={r.href} href={r.href} className="sheet__row">
            <span className="settings-row__text"><span>{r.title}</span><span className="settings-row__sub">{r.sub}</span></span>
            <Icon name="chevron" size={20} style={{ color: 'var(--border-2)' }} />
          </Link>
        ))}
      </div>

      {(form.regimen || form.infusionAgents.length > 0) && (
        <details className="settings-more">
          <summary>{t('overview.followUps')}</summary>
          <div className="muted" style={{ fontSize: 13, lineHeight: 1.5, margin: '6px 0' }}>{t('overview.followUpsHint')}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{followUps}</div>
          {followMsg && !sheet && <div className="msg msg--ok" style={{ marginTop: 8 }}>{followMsg}</div>}
        </details>
      )}

      <BottomSheet open={sheet} onClose={closeSheet} title={loaded ? t('overview.loadedTitle') : t('overview.change')}>
        {!loaded ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="sheet__list">
              {data.presets.map((p) => (
                <label key={p.id} className="choice-row">
                  <input type="radio" name="preset" checked={pick === p.id} onChange={() => setPick(p.id)} />
                  <span><b>{p.name}</b> <span className="muted" style={{ fontSize: 12 }}>· {t(`status.${p.status}`)}</span><br /><span className="muted" style={{ fontSize: 13 }}>{p.summary}</span></span>
                </label>
              ))}
            </div>
            <div className="muted" style={{ fontSize: 13 }}>{t('overview.replaceHint')}</div>
            {err && <div className="msg msg--error">{err}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn--primary" onClick={loadPreset} disabled={busy || !pick}>{t('overview.load')}</button>
              <button type="button" className="btn btn--ghost" onClick={closeSheet}>{t('overview.cancel')}</button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>{t('overview.loadedMsg', { name: loaded })}</div>
            {(form.regimen || form.infusionAgents.length > 0) && <div className="muted" style={{ fontSize: 14 }}>{t('overview.canCreate')}</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>{followUps}</div>
            {followMsg && <div className="msg msg--ok">{followMsg}</div>}
            {err && <div className="msg msg--error">{err}</div>}
            <div><button type="button" className="btn btn--primary" onClick={closeSheet}>{t('done')}</button></div>
          </div>
        )}
      </BottomSheet>
    </>
  );
}
