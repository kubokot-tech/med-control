'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'use-intl';
import { errorRu } from './api';
import Icon from './icons';
import RecoveryCode from './RecoveryCode';
import { signedIn, MIN_PASSWORD } from './labUtils';
import { REGIONS, DEFAULT_PREFS, guessRegion } from '../../../shared/format.js';
import { useLanguage } from '../i18n/I18nProvider';
import { LANGUAGE_NAMES, LANGUAGES, type Language } from '../i18n/messages';

type Status = { needed: boolean; codeRequired?: boolean; credentialsSource: 'env' | 'settings' | 'none'; appUrl: string };

function browserTz(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Moscow'; } catch { return 'Europe/Moscow'; }
}
function regionOptions(language: Language): [string, string][] {
  const dn = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames([language], { type: 'region' }) : null;
  return REGIONS.map((r) => [r, dn?.of(r) || r] as [string, string]).sort((a, b) => a[1].localeCompare(b[1], language));
}
function timezones(current: string): string[] {
  let list: string[] = [];
  try { list = (Intl as any).supportedValuesOf?.('timeZone') || []; } catch { list = []; }
  if (!list.includes(current)) list = [current, ...list];
  return list;
}

/** First run: password, language, time zone, region. The rest comes after sign-in (ui/WelcomeFlow.tsx). */
export default function SetupForm() {
  const t = useTranslations('auth');
  const tSettings = useTranslations('settings');
  const { language, setLanguage } = useLanguage();
  const [status, setStatus] = useState<Status | null>(null);
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [recovery, setRecovery] = useState<string | null>(null);
  const [setupCode, setSetupCode] = useState('');
  const [tz, setTz] = useState(browserTz());
  const [region, setRegion] = useState(DEFAULT_PREFS.region);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => { setRegion(guessRegion(navigator.language)); }, []);
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`/api/gateway/setup/status?language=${language}`, { cache: 'no-store' });
        const j = (await r.json()) as Status;
        if (!j.needed) { window.location.replace('/login'); return; }
        setStatus(j);
      } catch { setMsg(t('setupForm.noServer')); }
    })();
    // the presets come in the wizard's language
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  const tooShort = password.length > 0 && password.length < MIN_PASSWORD;
  const mismatch = password2.length > 0 && password !== password2;
  const canSubmit = (!status?.codeRequired || setupCode.trim().length >= 8) && password.length >= MIN_PASSWORD && password === password2 && !busy;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true); setMsg(null);
    try {
      const body: Record<string, string> = { password, tz, region, language };
      if (status?.codeRequired) body.setupCode = setupCode.trim();
      const r = await fetch('/api/gateway/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (r.status === 409 && j.error === 'setup_done') { window.location.replace('/login'); return; }
      if (!r.ok) { setMsg(errorRu(j)); return; }
      signedIn(j);
      if (j.recoveryCode) setRecovery(j.recoveryCode); else window.location.href = '/welcome';
    } catch {
      setMsg(t('connectionError'));
    } finally {
      setBusy(false);
    }
  }

  if (recovery) return <RecoveryCode code={recovery} onDone={() => { window.location.href = '/welcome'; }} doneLabel={t('setupForm.continue')} />;
  if (!status) return msg ? <div className="msg msg--error">{msg}</div> : <div className="muted">{t('setupForm.loading')}</div>;

  return (
    <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="muted" style={{ lineHeight: 1.5 }}>
        {t('setupForm.intro')}
      </div>
      {status.codeRequired && (
        <div className="field">
          <label htmlFor="setup-code">{t('setupForm.code')}</label>
          <input id="setup-code" type="text" value={setupCode} onChange={(e) => setSetupCode(e.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="XXXX-XXXX" required />
          <span className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
            {t.rich('setupForm.codeHint', { code: (c) => <code>{c}</code> })}
          </span>
        </div>
      )}
      {/* for password managers: they save a password under a name, nobody types this one */}
      <input type="text" name="username" autoComplete="username" value="MedControl" readOnly hidden />
      <div className="field">
        <label htmlFor="setup-password">{t('setupForm.password')}</label>
        <input id="setup-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" autoFocus required minLength={MIN_PASSWORD} />
        {tooShort && <span className="muted" style={{ fontSize: 13 }}>{t('minLength')}</span>}
      </div>
      <div className="field">
        <label htmlFor="setup-password2">{t('setupForm.password2')}</label>
        <input id="setup-password2" type="password" value={password2} onChange={(e) => setPassword2(e.target.value)} autoComplete="new-password" required />
        {mismatch && <span className="muted" style={{ fontSize: 13 }}>{t('mismatch')}</span>}
      </div>
      <div className="field">
        <label htmlFor="setup-language">{tSettings('localeCard.language')}</label>
        <select id="setup-language" value={language} onChange={(e) => setLanguage(e.target.value as Language)} style={{ height: 40 }}>
          {(Object.keys(LANGUAGES) as Language[]).map((l) => <option key={l} value={l}>{LANGUAGE_NAMES[l]}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="setup-tz">{t('setupForm.timezone')}</label>
        <select id="setup-tz" value={tz} onChange={(e) => setTz(e.target.value)} style={{ height: 40 }}>
          {timezones(tz).map((z) => <option key={z} value={z}>{z}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="setup-region">{t('setupForm.region')}</label>
        <select id="setup-region" value={region} onChange={(e) => setRegion(e.target.value)} style={{ height: 40 }}>
          {regionOptions(language).map(([r, name]) => <option key={r} value={r}>{name}</option>)}
        </select>
        <span className="muted" style={{ fontSize: 13 }}>{t('setupForm.regionHint')}</span>
      </div>

      <button type="submit" disabled={!canSubmit} className="btn btn--primary btn--lg btn--block" style={{ marginTop: 6 }}>
        <Icon name="check" strokeWidth={2.2} />
        {busy ? t('setupForm.saving') : t('setupForm.start')}
      </button>
      {msg && <div className="msg msg--error">{msg}</div>}
    </form>
  );
}
