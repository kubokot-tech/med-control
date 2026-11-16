'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'use-intl';
import { apiJson, errorRu, todayKey } from './api';
import { Avatar, squarePhoto } from './Avatar';

type Card = { name: string; birthDate: string; diagnosis: string; callName: string; keptBy: 'self' | 'relative'; photo: string; moments: boolean };

/**
 * Settings → patient and anamnesis → patient: who the doctor report is about (its header), and how the home screen
 * addresses them: a short name and whether the diary is kept by the patient or by someone close. The names and the
 * date of birth stay out of everything sent to AI; AI gets the age and the diagnosis.
 */
export default function PatientCard() {
  const t = useTranslations('settings');
  const [c, setC] = useState<Card | null>(null);
  const [saved, setSaved] = useState<Card | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { apiJson<Card>('/api/gateway/settings/patient').then((r) => { setC(r); setSaved(r); }).catch((e) => setErr(errorRu(e))); }, []);
  if (!c) return err ? <div className="msg msg--error">{err}</div> : null;
  const dirty = JSON.stringify(c) !== JSON.stringify(saved);

  async function pickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !c) return;
    setErr(null);
    try { setC({ ...c, photo: await squarePhoto(file) }); } catch { setErr(t('patientCard.photoError')); }
  }

  async function save() {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await apiJson<Card>('/api/gateway/settings/patient', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(c) });
      setC(r); setSaved(r); setMsg(t('patientCard.saved'));
    } catch (e) { setErr(errorRu(e)); } finally { setBusy(false); }
  }

  return (
    <div className="card meds-card">
      <div className="card__title">{t('patientCard.title')}</div>
      <div className="muted" style={{ fontSize: 14, lineHeight: 1.5 }}>{t('patientCard.intro')}</div>
      <label className="field"><span>{t('patientCard.name')}</span><input value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} maxLength={120} autoComplete="off" placeholder={t('patientCard.namePlaceholder')} /></label>
      <label className="field" style={{ maxWidth: 220 }}><span>{t('patientCard.birthDate')}</span><input type="date" value={c.birthDate} max={todayKey()} min="1900-01-01" onChange={(e) => setC({ ...c, birthDate: e.target.value })} /></label>
      <label className="field"><span>{t('patientCard.diagnosis')}</span><input value={c.diagnosis} onChange={(e) => setC({ ...c, diagnosis: e.target.value })} maxLength={200} autoComplete="off" placeholder={t('patientCard.diagnosisPlaceholder')} /></label>
      <div className="field">
        <span>{t('patientCard.photo')}</span>
        <div className="avatar-edit">
          <Avatar who={c} size={64} placeholder />
          <label className="btn btn--secondary btn--sm">
            {c.photo ? t('patientCard.photoChange') : t('patientCard.photoAdd')}
            <input type="file" accept="image/*" hidden onChange={pickPhoto} />
          </label>
          {c.photo && <button type="button" className="btn btn--ghost btn--sm" onClick={() => setC({ ...c, photo: '' })}>{t('patientCard.photoRemove')}</button>}
        </div>
        <div className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>{t('patientCard.photoHint')}</div>
      </div>
      <div className="field">
        <span>{t('patientCard.keptBy')}</span>
        <div className="seg" role="radiogroup" aria-label={t('patientCard.keptBy')}>
          {(['self', 'relative'] as const).map((v) => (
            <button key={v} type="button" role="radio" aria-checked={c.keptBy === v} className={`seg__btn ${c.keptBy === v ? 'seg__btn--active' : ''}`} onClick={() => setC({ ...c, keptBy: v })}>{t(`patientCard.keptByOption.${v}`)}</button>
          ))}
        </div>
      </div>
      <label className="field"><span>{t('patientCard.callName')}</span><input value={c.callName} onChange={(e) => setC({ ...c, callName: e.target.value })} maxLength={40} autoComplete="off" placeholder={t(`patientCard.callNamePlaceholder.${c.keptBy}`)} /></label>
      <div className="muted" style={{ fontSize: 13, lineHeight: 1.5, marginTop: -6 }}>{t(`patientCard.callNameHint.${c.keptBy}`)}</div>
      <label className="choice-row"><input type="checkbox" checked={c.moments} onChange={(e) => setC({ ...c, moments: e.target.checked })} /><span>{t('patientCard.moments')}</span></label>
      <div className="muted" style={{ fontSize: 13, lineHeight: 1.5, marginTop: -6 }}>{t('patientCard.momentsHint')}</div>
      <div><button type="button" className="btn btn--primary btn--sm" onClick={save} disabled={busy || !dirty}>{busy ? t('patientCard.saving') : t('patientCard.save')}</button></div>
      {msg && !dirty && <div className="msg msg--ok">{msg}</div>}
      {err && <div className="msg msg--error">{err}</div>}
    </div>
  );
}
