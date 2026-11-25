'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'use-intl';
import Icon from './icons';
import FileButton from './FileButton';
import { comparatorOf } from '../../../shared/labBounds.js';
import { apiFetch, flagFor, getToken } from './labUtils';
import { errorRu } from './api';
import { useEdition } from './edition';

type Preset = { id: string; name: string; status: 'ready' | 'example'; summary: string };
type ProviderId = 'openrouter' | 'anthropic' | 'openai' | 'gigachat';
type Upload = { name: string; state: 'busy' | 'done' | 'review' | 'duplicate' | 'error'; inserted?: number; error?: string };
type SummaryRow = { name?: string; short?: string; test?: string; unit?: string; refLow?: number | null; refHigh?: number | null; cells: Record<string, { valueNum?: number | null; valueText?: string | null; unit?: string | null; refLow?: number | null; refHigh?: number | null }> };

const STEP_KEY = 'mc_welcome_step';
const STEPS = ['about', 'protocol', 'anamnesis', 'ai', 'labs', 'done'] as const;
const KEY_FIELD: Record<ProviderId, string> = { openrouter: 'openrouterApiKey', anthropic: 'anthropicApiKey', openai: 'openaiApiKey', gigachat: 'gigachatAuthKey' };
const AI_STEPS: Record<ProviderId, 1 | 2 | 3 | 4 | 5> = { openrouter: 5, anthropic: 5, openai: 5, gigachat: 4 };

async function send(url: string, method: string, body: unknown) {
  const r = await apiFetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(errorRu(j, `HTTP ${r.status}`));
  return j;
}

/** The latest value of a summary row outside its range, for the last step. */
function outOfRange(rows: SummaryRow[], months: string[]) {
  const found: { name: string; value: string; unit: string }[] = [];
  for (const row of rows) {
    const month = [...months].reverse().find((m) => row.cells[m]?.valueNum != null);
    const cell = month ? row.cells[month] : null;
    if (!cell || cell.valueNum == null) continue;
    const flag = flagFor(cell.valueNum, cell.refLow, cell.refHigh, cell.valueText);
    if (flag === 'low' || flag === 'high') found.push({ name: row.short || row.name || row.test || '', value: comparatorOf(cell.valueText) + cell.valueNum, unit: cell.unit || '' });
  }
  return found;
}

/**
 * The first visit after the password: who keeps the history, the diagnosis, the protocol, the anamnesis, AI, first lab
 * reports. Every step can be skipped and is saved on «Next»; anything left out stays on the Today checklist.
 */
export default function WelcomeFlow() {
  const t = useTranslations('welcome');
  const ed = useEdition();
  const [ready, setReady] = useState(false);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [keptBy, setKeptBy] = useState<'self' | 'relative'>('self');
  const [callName, setCallName] = useState('');
  const [diagnosis, setDiagnosis] = useState('');
  const [presets, setPresets] = useState<Preset[]>([]);
  const [preset, setPreset] = useState('');
  const [savedPreset, setSavedPreset] = useState<string | null>(null); // already stored: «Next» does not load it again over the person's edits
  const [anamnesis, setAnamnesis] = useState('');
  const [extractNote, setExtractNote] = useState<string | null>(null);
  const [provider, setProvider] = useState<ProviderId>('openrouter');
  const [aiKey, setAiKey] = useState('');
  const [aiOk, setAiOk] = useState(false);
  // connecting AI needs the password once the grace after sign-in is over (gateway: 403 password_required)
  const [aiAskPassword, setAiAskPassword] = useState(false);
  const [aiPassword, setAiPassword] = useState('');
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [overview, setOverview] = useState<{ values: number; flagged: { name: string; value: string; unit: string }[] } | null>(null);

  useEffect(() => {
    if (!getToken()) { window.location.replace('/login'); return; }
    try { const s = Number(localStorage.getItem(STEP_KEY)); if (s > 0 && s < STEPS.length) setStep(s); } catch { /* private mode */ }
    setReady(true);
    apiFetch('/api/gateway/settings/patient').then(async (r) => {
      if (!r.ok) return;
      const j = await r.json();
      setKeptBy(j.keptBy || 'self'); setCallName(j.callName || ''); setDiagnosis(j.diagnosis || '');
    }).catch(() => {});
    apiFetch('/api/gateway/protocol').then(async (r) => {
      if (!r.ok) return;
      const j = await r.json();
      const list: Preset[] = j.presets || [];
      setPresets(list);
      // Preselected: the protocol in force, which is general monitoring (the first of the list) until one is chosen.
      // A stored protocol of the person's own, with no preset behind it, gets no preselection: «Next» would replace it.
      const inForce = list.some((p) => p.id === j.protocol?.preset) ? j.protocol.preset : j.stored ? '' : list[0]?.id || '';
      setPreset((cur) => cur || inForce);
      if (j.stored) setSavedPreset(j.protocol?.preset ?? null);
    }).catch(() => {});
  }, []);

  const go = useCallback((n: number) => {
    setErr(null); setStep(n);
    try { localStorage.setItem(STEP_KEY, String(n)); } catch { /* private mode */ }
    window.scrollTo(0, 0);
  }, []);

  /** Save the step, then move on; an error keeps the person on the step. */
  async function next(save?: () => Promise<unknown>) {
    setBusy(true); setErr(null);
    try { if (save) await save(); go(step + 1); } catch (e: any) { setErr(String(e?.message || e)); } finally { setBusy(false); }
  }

  const saveAbout = () => send('/api/gateway/settings/patient', 'PUT', { keptBy, callName: callName.trim(), diagnosis: diagnosis.trim() });
  const savePreset = () => (preset && preset !== savedPreset ? send('/api/gateway/protocol/preset', 'POST', { preset }).then(() => setSavedPreset(preset)) : Promise.resolve());
  const saveAnamnesis = () => (anamnesis.trim() ? send('/api/gateway/ai/settings', 'PUT', { anamnesis: anamnesis.trim(), source: 'manual', note: t('anamnesis.versionNote') }) : Promise.resolve());

  async function readDocument(file: File) {
    setBusy(true); setErr(null); setExtractNote(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await apiFetch('/api/gateway/settings/anamnesis/extract', { method: 'POST', body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(errorRu(j, `HTTP ${r.status}`));
      setAnamnesis((cur) => (cur.trim() ? `${cur.trim()}\n\n${j.text}` : j.text));
      setExtractNote([j.method === 'ocr' ? t('anamnesis.readOcr') : t('anamnesis.readText'), j.truncated ? t('anamnesis.truncated') : ''].filter(Boolean).join(' '));
    } catch (e: any) { setErr(String(e?.message || e)); } finally { setBusy(false); }
  }

  async function connectAi() {
    setBusy(true); setErr(null); setAiOk(false);
    const confirm = aiPassword ? { password: aiPassword } : {};
    try {
      const r = await apiFetch('/api/gateway/ai/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider, [KEY_FIELD[provider]]: aiKey.trim(), ...confirm }) });
      const j = await r.json().catch(() => ({}));
      if (r.status === 403 && (j.error === 'password_required' || j.error === 'invalid_password')) {
        // nothing was saved: ask for the password and let the person press the button again
        setAiAskPassword(true); setAiPassword('');
        if (j.error === 'invalid_password') setErr(errorRu(j));
        return;
      }
      if (!r.ok) throw new Error(errorRu(j, `HTTP ${r.status}`));
      await send('/api/gateway/ai/ping', 'POST', { tier: 'fast' });
      setAiKey(''); setAiOk(true); setAiAskPassword(false); setAiPassword('');
    } catch {
      // a key that did not pass stays out of the settings: nothing half connected behind the person's back
      await send('/api/gateway/ai/settings', 'PUT', { [KEY_FIELD[provider]]: '', ...confirm }).catch(() => {});
      setErr(t('ai.failed'));
    } finally { setBusy(false); }
  }

  async function uploadLabs(files: File[]) {
    const list = files;
    const offset = uploads.length;
    setUploads((u) => [...u, ...list.map((f) => ({ name: f.name, state: 'busy' as const }))]);
    const patch = (i: number, p: Partial<Upload>) => setUploads((u) => u.map((x, k) => (k === offset + i ? { ...x, ...p } : x)));
    for (const [i, file] of list.entries()) {
      try {
        const fd = new FormData();
        fd.append('file', file);
        const r = await apiFetch('/api/gateway/labs/commit-pdf', { method: 'POST', body: fd });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(errorRu(j, `HTTP ${r.status}`));
        patch(i, j.needsReview ? { state: 'review' } : j.already ? { state: 'duplicate' } : { state: 'done', inserted: j.inserted });
      } catch (e: any) { patch(i, { state: 'error', error: String(e?.message || e) }); }
    }
  }

  useEffect(() => {
    if (STEPS[step] !== 'done') return;
    try { localStorage.removeItem(STEP_KEY); } catch { /* private mode */ }
    apiFetch('/api/gateway/labs/summary?months=all').then(async (r) => {
      if (!r.ok) return;
      const j = await r.json();
      const rows: SummaryRow[] = j.rows || [];
      setOverview({ values: rows.length, flagged: outOfRange(rows, j.months || []) });
    }).catch(() => {});
  }, [step]);

  if (!ready) return null;
  const name = STEPS[step];
  const relative = keptBy === 'relative';
  const nav = (onNext: () => void, canNext = true, label = t('next')) => (
    <div className="welcome__nav">
      {step > 0 && <button type="button" className="btn btn--ghost" onClick={() => go(step - 1)} disabled={busy}>{t('back')}</button>}
      <button type="button" className="btn btn--ghost" onClick={() => go(step + 1)} disabled={busy}>{t('skip')}</button>
      <button type="button" className="btn btn--primary" onClick={onNext} disabled={busy || !canNext}>{busy ? t('saving') : label}</button>
    </div>
  );

  return (
    <div className="login-page">
      <div className="login-card welcome">
        {name !== 'done' && (
          <div className="welcome__progress" aria-label={t('progress', { n: step + 1, total: STEPS.length - 1 })}>
            <span className="muted">{t('progress', { n: step + 1, total: STEPS.length - 1 })}</span>
            <span className="welcome__bar"><span style={{ width: `${((step + 1) / (STEPS.length - 1)) * 100}%` }} /></span>
          </div>
        )}

        {name === 'about' && (
          <>
            <div><h1 className="welcome__title">{t('about.title')}</h1><p className="muted welcome__lead">{t('about.lead')}</p></div>
            <div className="field">
              <span className="welcome__label">{t('about.who')}</span>
              <div className="seg" role="radiogroup" aria-label={t('about.who')}>
                {(['self', 'relative'] as const).map((k) => (
                  <button key={k} type="button" role="radio" aria-checked={keptBy === k} className={`seg__btn ${keptBy === k ? 'seg__btn--active' : ''}`} onClick={() => setKeptBy(k)}>{t(`about.keptBy.${k}`)}</button>
                ))}
              </div>
            </div>
            <div className="field">
              <label htmlFor="welcome-name">{relative ? t('about.nameRelative') : t('about.nameSelf')}</label>
              <input id="welcome-name" type="text" value={callName} maxLength={40} onChange={(e) => setCallName(e.target.value)} placeholder={relative ? t('about.nameRelativeHint') : t('about.nameSelfHint')} autoFocus />
            </div>
            <div className="field">
              <label htmlFor="welcome-diagnosis">{t('about.diagnosis')}</label>
              <input id="welcome-diagnosis" type="text" value={diagnosis} maxLength={200} onChange={(e) => setDiagnosis(e.target.value)} placeholder={t('about.diagnosisHint')} />
              <span className="muted welcome__note">{t('about.diagnosisWhy')}</span>
            </div>
            {nav(() => next(saveAbout))}
          </>
        )}

        {name === 'protocol' && (
          <>
            <div><h1 className="welcome__title">{t('protocol.title')}</h1><p className="muted welcome__lead">{t('protocol.lead')}</p></div>
            <div>
              {presets.map((p) => (
                <label key={p.id} className="choice-row">
                  <input type="radio" name="preset" checked={preset === p.id} onChange={() => setPreset(p.id)} />
                  <span><b>{p.name}</b><br /><span className="muted welcome__note">{p.summary}</span></span>
                </label>
              ))}
            </div>
            <div className="msg msg--warning welcome__note">{t('protocol.warning')}</div>
            {nav(() => next(savePreset))}
          </>
        )}

        {name === 'anamnesis' && (
          <>
            <div><h1 className="welcome__title">{t('anamnesis.title')}</h1><p className="muted welcome__lead">{t('anamnesis.lead')}</p></div>
            <div>
              <FileButton className="btn btn--secondary" accept=".pdf,.txt,.md,image/jpeg,image/png" disabled={busy} onFiles={(files) => { const f = files[0]; if (f) readDocument(f); }}><Icon name="upload" />{busy ? t('anamnesis.reading') : t('anamnesis.upload')}</FileButton>
              <p className="muted welcome__note">{t('anamnesis.uploadHint')}</p>
            </div>
            <div className="field">
              <label htmlFor="welcome-anamnesis">{t('anamnesis.text')}</label>
              <textarea id="welcome-anamnesis" rows={10} maxLength={20000} value={anamnesis} onChange={(e) => setAnamnesis(e.target.value)} placeholder={t('anamnesis.placeholder')} />
              {extractNote && <span className="muted welcome__note">{extractNote}</span>}
            </div>
            {nav(() => next(saveAnamnesis))}
          </>
        )}

        {name === 'ai' && (
          <>
            <div><h1 className="welcome__title">{t('ai.title')}</h1><p className="muted welcome__lead">{t('ai.lead')}</p></div>
            <ul className="welcome__list">
              {(['labs', 'explain', 'visit', 'chat'] as const).map((k) => <li key={k}>{t(`ai.gives.${k}`)}</li>)}
            </ul>
            <p className="muted welcome__note">{t('ai.data')}</p>
            <div className="seg" role="tablist">
              {(['openrouter', 'anthropic', 'openai', 'gigachat'] as const).map((p) => (
                <button key={p} type="button" role="tab" aria-selected={provider === p} className={`seg__btn ${provider === p ? 'seg__btn--active' : ''}`} onClick={() => { setProvider(p); setAiOk(false); setErr(null); }}>{t(`ai.tab.${p}`)}</button>
              ))}
            </div>
            <ol className="welcome__list">
              {Array.from({ length: AI_STEPS[provider] }, (_, i) => <li key={i}>{t.rich(`ai.${provider}.s${(i + 1) as 1}`, { b: (c) => <b>{c}</b>, code: (c) => <code>{c}</code> })}</li>)}
            </ol>
            <div className="msg msg--warning welcome__note">{t(`ai.${provider}.warning`)}</div>
            <div className="field">
              <label htmlFor="welcome-key">{t(`ai.${provider}.keyLabel`)}</label>
              <input id="welcome-key" type="password" autoComplete="off" value={aiKey} onChange={(e) => { setAiKey(e.target.value); setAiOk(false); }} />
            </div>
            {aiAskPassword && (
              <div className="field">
                <label htmlFor="welcome-password">{t('ai.passwordLabel')}</label>
                <input id="welcome-password" type="password" autoComplete="current-password" value={aiPassword} onChange={(e) => setAiPassword(e.target.value)} />
                <span className="muted welcome__note">{t('ai.passwordHint')}</span>
              </div>
            )}
            <button type="button" className="btn btn--secondary" onClick={connectAi} disabled={busy || !aiKey.trim() || (aiAskPassword && !aiPassword)}>{busy ? t('ai.checking') : t('ai.connect')}</button>
            {aiOk && <div className="msg msg--ok">{t('ai.connected')}</div>}
            <p className="muted welcome__note">{t('ai.other')}</p>
            {nav(() => go(step + 1), aiOk)}
          </>
        )}

        {name === 'labs' && (
          <>
            <div><h1 className="welcome__title">{t('labs.title')}</h1><p className="muted welcome__lead">{t('labs.lead')}</p></div>
            <FileButton className="btn btn--secondary" multiple accept="application/pdf,.pdf" onFiles={uploadLabs}><Icon name="upload" />{t('labs.choose')}</FileButton>
            {uploads.length > 0 && (
              <div className="sheet__list">
                {uploads.map((u, i) => (
                  <div key={i} className="list-row welcome__upload">
                    <span>{u.name}</span>
                    <span className="muted welcome__note">{u.state === 'done' ? t('labs.done', { n: u.inserted ?? 0 }) : t.rich(`labs.state.${u.state === 'error' ? 'error' : u.state}`, { reason: u.error || '', link: (c) => <Link href="/labs/upload">{c}</Link> })}</span>
                  </div>
                ))}
              </div>
            )}
            <p className="muted welcome__note">{t('labs.hint')}</p>
            {nav(() => go(step + 1), uploads.some((u) => u.state === 'done' || u.state === 'duplicate'))}
          </>
        )}

        {name === 'done' && (
          <>
            <div><h1 className="welcome__title">{t('done.title')}</h1><p className="muted welcome__lead">{callName.trim() && !relative ? t('done.leadName', { name: callName.trim() }) : t('done.lead')}</p></div>
            {overview && overview.values > 0 && (
              <div className="card meds-card">
                <div className="card__title">{t('done.labsTitle', { n: overview.values })}</div>
                {overview.flagged.length > 0 ? (
                  <>
                    <div className="muted welcome__note">{t('done.flagged', { n: overview.flagged.length })}</div>
                    <ul className="welcome__list">{overview.flagged.slice(0, 6).map((f) => <li key={f.name}>{f.name}: {f.value} {f.unit}</li>)}</ul>
                    <div className="muted welcome__note">{t('done.flaggedNote')}</div>
                  </>
                ) : <div className="muted welcome__note">{t('done.noneFlagged')}</div>}
                <Link href="/labs/summary" className="btn btn--secondary">{t('done.openLabs')}</Link>
              </div>
            )}
            <div className="muted welcome__note">{t(ed.available('telegram') ? 'done.later' : 'done.laterDevice')}</div>
            <Link href="/" className="btn btn--primary btn--lg btn--block">{t('done.open')}</Link>
          </>
        )}

        {err && <div className="msg msg--error">{err}</div>}
      </div>
    </div>
  );
}
