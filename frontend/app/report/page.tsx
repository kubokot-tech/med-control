'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'use-intl';
import Icon from '../ui/icons';
import Link from 'next/link';
import { apiFetch } from '../ui/labUtils';
import { todayKey } from '../ui/api';
import { activeLanguage } from '../i18n/messages';

function addMonths(key: string, n: number) {
  const d = new Date(key + 'T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10);
}

const SECTION_KEYS = ['anamnesis', 'therapy', 'infusions', 'milestones', 'imaging', 'labs', 'symptoms', 'alerts', 'documents'] as const;

export default function ReportPage() {
  const t = useTranslations('report');
  const today = todayKey();
  const [preset, setPreset] = useState<'3m' | '6m' | '12m' | 'custom'>('3m');
  const [from, setFrom] = useState(addMonths(today, -3));
  const [to, setTo] = useState(today);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [withQuestions, setWithQuestions] = useState(true);
  const [sections, setSections] = useState<Record<string, boolean>>(() => {
    try { const saved = typeof window !== 'undefined' ? localStorage.getItem('dtc_report_sections') : null; if (saved) return JSON.parse(saved); } catch { /* ignore */ }
    return { anamnesis: false, therapy: true, infusions: true, milestones: true, imaging: true, labs: true, symptoms: true, alerts: true, documents: false };
  });
  const [opts, setOpts] = useState<{ anamnesis: 'brief' | 'full'; milestones: 'period' | 'all'; labs: 'key' | 'all' }>(() => {
    try { const saved = typeof window !== 'undefined' ? localStorage.getItem('dtc_report_opts') : null; if (saved) return JSON.parse(saved); } catch { /* ignore */ }
    return { anamnesis: 'brief', milestones: 'period', labs: 'key' };
  });
  const [presetName, setPresetName] = useState<string>('');
  function applyPreset(name: 'new' | 'own' | 'all') {
    setPresetName(name);
    if (name === 'new') { setSections({ anamnesis: true, therapy: true, infusions: true, milestones: true, imaging: true, labs: true, symptoms: true, alerts: true, documents: true }); setOpts({ anamnesis: 'brief', milestones: 'all', labs: 'key' }); setWithQuestions(true); }
    if (name === 'own') { setSections({ anamnesis: false, therapy: true, infusions: false, milestones: true, imaging: true, labs: true, symptoms: true, alerts: true, documents: false }); setOpts({ anamnesis: 'brief', milestones: 'period', labs: 'key' }); setWithQuestions(true); }
    if (name === 'all') { setSections({ anamnesis: true, therapy: true, infusions: true, milestones: true, imaging: true, labs: true, symptoms: true, alerts: true, documents: true }); setOpts({ anamnesis: 'full', milestones: 'all', labs: 'all' }); setWithQuestions(true); }
  }
  // the header shows who the patient is; offer to fill it in when it is empty
  const [noPatient, setNoPatient] = useState(false);
  useEffect(() => { apiFetch('/api/gateway/settings/patient').then(async (r) => { if (r.ok) { const j = await r.json(); setNoPatient(!j.name && !j.diagnosis); } }).catch(() => {}); }, []);
  const toggle = (k: string) => { setPresetName(''); setSections((s) => ({ ...s, [k]: !s[k] })); };
  useEffect(() => { try { localStorage.setItem('dtc_report_sections', JSON.stringify(sections)); localStorage.setItem('dtc_report_opts', JSON.stringify(opts)); } catch { /* ignore */ } }, [sections, opts]);
  const reportQuery = () => {
    const list: string[] = SECTION_KEYS.filter((k) => sections[k]);
    if (withQuestions) list.unshift('questions');
    return `from=${from}&to=${to}&sections=${list.join(',')}&anamnesis=${opts.anamnesis}&milestones=${opts.milestones}&labs=${opts.labs}`;
  };
  const [dNotes, setDNotes] = useState(true);
  const [dAi, setDAi] = useState(false);
  const [dAllLabs, setDAllLabs] = useState(false);
  const [dDocs, setDDocs] = useState(true);
  const [dBusy, setDBusy] = useState(false);
  const [dMsg, setDMsg] = useState<string | null>(null);
  const dossierUrl = () => `/api/gateway/export/dossier.md?from=${from}&to=${to}${dNotes ? '' : '&notes=0'}${dAi ? '&ai=1' : ''}${dAllLabs ? '&all_labs=1' : ''}${dDocs ? '' : '&docs=0'}`;
  async function dossierDownload() {
    setDBusy(true); setErr(null); setDMsg(null);
    try {
      const r = await apiFetch(dossierUrl());
      if (!r.ok) throw new Error(await r.text());
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${activeLanguage() === 'ru' ? 'dtc' : 'medcontrol'}-dossier-${to}.md`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      setDMsg(t('dossier.downloaded', { size: Math.round(blob.size / 1024) }));
    } catch (e: any) { setErr(String(e?.message || e)); } finally { setDBusy(false); }
  }
  async function dossierCopy() {
    setDBusy(true); setErr(null); setDMsg(null);
    try {
      const r = await apiFetch(dossierUrl());
      if (!r.ok) throw new Error(await r.text());
      const text = await r.text();
      await navigator.clipboard.writeText(text);
      setDMsg(t('dossier.copied', { n: Math.round(text.length / 1000) }));
    } catch (e: any) { setErr(String(e?.message || e)); } finally { setDBusy(false); }
  }

  function pick(p: '3m' | '6m' | '12m') {
    setPreset(p);
    setFrom(addMonths(today, p === '3m' ? -3 : p === '6m' ? -6 : -12));
    setTo(today);
  }

  async function download() {
    setBusy(true); setErr(null);
    try {
      const r = await apiFetch(`/api/gateway/report/doctor.pdf?${reportQuery()}`);
      if (!r.ok) throw new Error(await r.text());
      const named = /filename\*=UTF-8''([^;]+)/.exec(r.headers.get('content-disposition') || '');
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement('a');
      a.href = url; a.download = named ? decodeURIComponent(named[1]) : `MedControl-${from}-${to}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e: any) { setErr(String(e?.message || e)); } finally { setBusy(false); }
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-header__title">{t('title')}</h1>
        <p className="page-header__desc">{t('desc')}</p>
      </div>
      {err && <div className="msg msg--error" style={{ marginBottom: 16 }}>{err}</div>}
      <div className="card meds-card" style={{ maxWidth: 560 }}>
        <div className="sym-field">
          <div className="sym-field__label">{t('period')}</div>
          <div className="seg">
            {(['3m', '6m', '12m'] as const).map((p) => <button key={p} type="button" className={`seg__btn ${preset === p ? 'seg__btn--active' : ''}`} onClick={() => pick(p)}>{t(`presets.${p}`)}</button>)}
            <button type="button" className={`seg__btn ${preset === 'custom' ? 'seg__btn--active' : ''}`} onClick={() => setPreset('custom')}>{t('customDates')}</button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <label className="field" style={{ flex: 1 }}><span>{t('from')}</span><input type="date" value={from} max={to} onChange={(e) => { setFrom(e.target.value); setPreset('custom'); }} /></label>
          <label className="field" style={{ flex: 1 }}><span>{t('to')}</span><input type="date" value={to} max={today} onChange={(e) => { setTo(e.target.value); setPreset('custom'); }} /></label>
        </div>
        <div className="sym-field">
          <div className="sym-field__label">{t('audience')}</div>
          <div className="seg">
            <button type="button" className={`seg__btn ${presetName === 'new' ? 'seg__btn--active' : ''}`} onClick={() => applyPreset('new')} title={t('audienceNewHint')}>{t('audienceNew')}</button>
            <button type="button" className={`seg__btn ${presetName === 'own' ? 'seg__btn--active' : ''}`} onClick={() => applyPreset('own')} title={t('audienceOwnHint')}>{t('audienceOwn')}</button>
            <button type="button" className={`seg__btn ${presetName === 'all' ? 'seg__btn--active' : ''}`} onClick={() => applyPreset('all')}>{t('audienceAll')}</button>
          </div>
        </div>
        <label className="list-row" style={{ cursor: 'pointer' }}>
          <span>{t('questions')}<br /><span className="muted" style={{ fontSize: 13 }}>{t('questionsHint')}</span></span>
          <input type="checkbox" checked={withQuestions} onChange={(e) => { setPresetName(''); setWithQuestions(e.target.checked); }} />
        </label>
        {SECTION_KEYS.map((k) => (
          <label key={k} className="list-row" style={{ cursor: 'pointer' }}>
            <span>{t(`sections.${k}.label`)}<br /><span className="muted" style={{ fontSize: 13 }}>{t(`sections.${k}.hint`)}</span>
              {k === 'anamnesis' && sections.anamnesis && <span className="seg" style={{ marginLeft: 8, verticalAlign: 'middle' }}><button type="button" className={`seg__btn btn--sm ${opts.anamnesis === 'brief' ? 'seg__btn--active' : ''}`} style={{ height: 28, padding: '0 8px' }} onClick={(e) => { e.preventDefault(); setOpts({ ...opts, anamnesis: 'brief' }); }}>{t('opts.anamnesisBrief')}</button><button type="button" className={`seg__btn ${opts.anamnesis === 'full' ? 'seg__btn--active' : ''}`} style={{ height: 28, padding: '0 8px' }} onClick={(e) => { e.preventDefault(); setOpts({ ...opts, anamnesis: 'full' }); }}>{t('opts.anamnesisFull')}</button></span>}
              {k === 'milestones' && sections.milestones && <span className="seg" style={{ marginLeft: 8, verticalAlign: 'middle' }}><button type="button" className={`seg__btn ${opts.milestones === 'period' ? 'seg__btn--active' : ''}`} style={{ height: 28, padding: '0 8px' }} onClick={(e) => { e.preventDefault(); setOpts({ ...opts, milestones: 'period' }); }}>{t('opts.milestonesPeriod')}</button><button type="button" className={`seg__btn ${opts.milestones === 'all' ? 'seg__btn--active' : ''}`} style={{ height: 28, padding: '0 8px' }} onClick={(e) => { e.preventDefault(); setOpts({ ...opts, milestones: 'all' }); }}>{t('opts.milestonesAll')}</button></span>}
              {k === 'labs' && sections.labs && <span className="seg" style={{ marginLeft: 8, verticalAlign: 'middle' }}><button type="button" className={`seg__btn ${opts.labs === 'key' ? 'seg__btn--active' : ''}`} style={{ height: 28, padding: '0 8px' }} onClick={(e) => { e.preventDefault(); setOpts({ ...opts, labs: 'key' }); }}>{t('opts.labsKey')}</button><button type="button" className={`seg__btn ${opts.labs === 'all' ? 'seg__btn--active' : ''}`} style={{ height: 28, padding: '0 8px' }} onClick={(e) => { e.preventDefault(); setOpts({ ...opts, labs: 'all' }); }}>{t('opts.labsAll')}</button></span>}
            </span>
            <input type="checkbox" checked={!!sections[k]} onChange={() => toggle(k)} />
          </label>
        ))}
        {noPatient && <div className="msg msg--warning" style={{ lineHeight: 1.5 }}>{t.rich('noPatient', { link: (c) => <Link href="/settings/anamnesis">{c}</Link> })}</div>}
        <button type="button" className="btn btn--primary btn--lg btn--block" onClick={download} disabled={busy}><Icon name="download" />{busy ? t('building') : t('downloadPdf')}</button>
        <div className="muted" style={{ fontSize: 14 }}>{t('footnote')}</div>
      </div>

      <div className="card meds-card" style={{ maxWidth: 560, marginTop: 16 }}>
        <div className="card__title">{t('dossier.title')}</div>
        <div className="muted" style={{ fontSize: 14, lineHeight: 1.5 }}>{t('dossier.desc')}</div>
        <label className="list-row" style={{ cursor: 'pointer' }}><span>{t('dossier.notes')}<br /><span className="muted" style={{ fontSize: 13 }}>{t('dossier.notesHint')}</span></span><input type="checkbox" checked={dNotes} onChange={(e) => setDNotes(e.target.checked)} /></label>
        <label className="list-row" style={{ cursor: 'pointer' }}><span>{t('dossier.docs')}<br /><span className="muted" style={{ fontSize: 13 }}>{t('dossier.docsHint')}</span></span><input type="checkbox" checked={dDocs} onChange={(e) => setDDocs(e.target.checked)} /></label>
        <label className="list-row" style={{ cursor: 'pointer' }}><span>{t('dossier.allLabs')}<br /><span className="muted" style={{ fontSize: 13 }}>{t('dossier.allLabsHint')}</span></span><input type="checkbox" checked={dAllLabs} onChange={(e) => setDAllLabs(e.target.checked)} /></label>
        <label className="list-row" style={{ cursor: 'pointer' }}><span>{t('dossier.ai')}<br /><span className="muted" style={{ fontSize: 13 }}>{t('dossier.aiHint')}</span></span><input type="checkbox" checked={dAi} onChange={(e) => setDAi(e.target.checked)} /></label>
        {dMsg && <div className="msg msg--ok">{dMsg}</div>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn--primary" onClick={dossierDownload} disabled={dBusy}><Icon name="download" />{dBusy ? t('building') : t('dossier.download')}</button>
          <button type="button" className="btn btn--secondary" onClick={dossierCopy} disabled={dBusy}>{t('dossier.copy')}</button>
        </div>
      </div>
    </div>
  );
}
