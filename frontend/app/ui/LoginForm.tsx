'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'use-intl';
import { startAuthentication, browserSupportsWebAuthn } from '@simplewebauthn/browser';
import { errorRu } from './api';
import Icon from './icons';
import { getToken, signedIn, deviceMark, MIN_PASSWORD } from './labUtils';
import { useEdition } from './edition';
import RecoveryCode from './RecoveryCode';

export default function LoginForm() {
  const t = useTranslations('auth');
  const ed = useEdition();
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [preToken, setPreToken] = useState<string | null>(null);
  const [canPasskey, setCanPasskey] = useState(false);
  // Forgot password: the recovery code from the first-run wizard and a new password
  const [recover, setRecover] = useState(false);
  const [code, setCode] = useState('');
  const [next, setNext] = useState('');
  const [next2, setNext2] = useState('');
  const [newCode, setNewCode] = useState<string | null>(null);

  useEffect(() => {
    if (getToken()) { window.location.replace('/'); return; }
    try { setCanPasskey(browserSupportsWebAuthn()); } catch { setCanPasskey(false); }
    // Fresh install without a password: go to the first-run wizard.
    fetch('/api/gateway/setup/status', { cache: 'no-store' }).then((r) => r.json()).then((j) => { if (j?.needed) window.location.replace('/setup'); }).catch(() => {});
  }, []);

  // Passkey-first: no password, the phone offers its saved key (Face ID / Touch ID).
  async function passkeyDirect() {
    setLoading(true);
    setMsg(null);
    try {
      const o = await fetch('/api/gateway/auth/passkey/direct/options', { method: 'POST' });
      const oj = await o.json().catch(() => ({}));
      if (!o.ok) { setMsg(o.status === 404 ? t('loginForm.noPasskeys') : errorRu(oj)); return; }
      let response;
      try {
        response = await startAuthentication({ optionsJSON: oj.options });
      } catch (e: any) {
        setMsg(e?.name === 'NotAllowedError' ? t('loginForm.cancelled') : t('loginForm.keyFailed', { error: String(e?.message || e) }));
        return;
      }
      const v = await fetch('/api/gateway/auth/passkey/direct/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: oj.sessionId, response }),
      });
      const vj = await v.json().catch(() => ({}));
      if (!v.ok) { setMsg(errorRu(vj, t('loginForm.keyRejected'))); return; }
      signedIn(vj);
      window.location.href = '/';
    } catch {
      setMsg(t('connectionError'));
    } finally {
      setLoading(false);
    }
  }

  async function passkeyStep(pre: string) {
    setLoading(true);
    setMsg(null);
    try {
      const o = await fetch('/api/gateway/auth/passkey/login/options', { method: 'POST', headers: { authorization: `Bearer ${pre}` } });
      if (o.status === 401) { setPreToken(null); setMsg(t('loginForm.expired')); return; }
      if (!o.ok) throw new Error('options');
      const options = await o.json();
      let response;
      try {
        response = await startAuthentication({ optionsJSON: options });
      } catch (e: any) {
        setMsg(e?.name === 'NotAllowedError' ? t('loginForm.cancelledRetry') : t('loginForm.keyFailed', { error: String(e?.message || e) }));
        return;
      }
      const v = await fetch('/api/gateway/auth/passkey/login/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', authorization: `Bearer ${pre}` },
        body: JSON.stringify({ response }),
      });
      if (v.status === 401) { setPreToken(null); setMsg(t('loginForm.expired')); return; }
      if (!v.ok) { setMsg(t('loginForm.keyRejectedRetry')); return; }
      const j = await v.json();
      signedIn(j);
      window.location.href = '/';
    } catch {
      setMsg(t('connectionError'));
    } finally {
      setLoading(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setLoading(true);
    try {
      const r = await fetch('/api/gateway/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, device: deviceMark() }),
      });
      if (r.status === 429) {
        const j = await r.json().catch(() => ({}));
        const sec = Number(j.retryAfterSec || 60);
        setMsg(sec >= 60 ? t('loginForm.tooManyMin', { n: Math.ceil(sec / 60) }) : t('loginForm.tooManySec', { n: sec }));
        return;
      }
      if (r.status === 409) { window.location.replace('/setup'); return; }
      if (!r.ok) {
        setMsg(t('loginForm.invalid'));
        return;
      }
      const j = await r.json();
      if (j.mfa === 'passkey') {
        setPreToken(j.preToken);
        setLoading(false);
        await passkeyStep(j.preToken);
        return;
      }
      signedIn(j);
      window.location.href = '/';
    } catch {
      setMsg(t('connectionError'));
    } finally {
      setLoading(false);
    }
  }

  async function onRecover(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setLoading(true);
    try {
      const r = await fetch('/api/gateway/auth/recover', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, next, device: deviceMark() }) });
      const j = await r.json().catch(() => ({}));
      if (r.status === 429) { const sec = Number(j.retryAfterSec || 60); setMsg(t('loginForm.tooManyMin', { n: Math.ceil(sec / 60) })); return; }
      if (r.status === 409 && j.error === 'set_in_env') { setMsg(t('loginForm.setInEnv')); return; }
      if (!r.ok) { setMsg(errorRu(j)); return; }
      signedIn(j);
      setNewCode(j.recoveryCode);
    } catch {
      setMsg(t('connectionError'));
    } finally {
      setLoading(false);
    }
  }

  if (newCode) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="msg msg--ok">{t('loginForm.changed')}</div>
        <RecoveryCode code={newCode} onDone={() => { window.location.href = '/'; }} doneLabel={t('loginForm.signIn')} />
      </div>
    );
  }

  if (recover) {
    const ok = code.trim().length >= 20 && next.length >= MIN_PASSWORD && next === next2 && !loading;
    return (
      <form onSubmit={onRecover} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="muted" style={{ lineHeight: 1.5 }}>{t('loginForm.recoverIntro')}</div>
        <div className="field">
          <label htmlFor="recovery-code">{t('loginForm.recoveryCode')}</label>
          <input id="recovery-code" type="text" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="XXXX-XXXX-XXXX-XXXX-XXXX" autoFocus required />
        </div>
        <div className="field">
          <label htmlFor="recovery-next">{t('loginForm.newPassword')}</label>
          <input id="recovery-next" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={MIN_PASSWORD} required />
        </div>
        <div className="field">
          <label htmlFor="recovery-next2">{t('loginForm.newPassword2')}</label>
          <input id="recovery-next2" type="password" value={next2} onChange={(e) => setNext2(e.target.value)} autoComplete="new-password" required />
        </div>
        {next.length > 0 && next.length < MIN_PASSWORD && <div className="muted" style={{ fontSize: 13 }}>{t('minLength')}</div>}
        {next2.length > 0 && next !== next2 && <div className="muted" style={{ fontSize: 13 }}>{t('mismatch')}</div>}
        <button type="submit" disabled={!ok} className="btn btn--primary btn--lg btn--block">{loading ? t('loginForm.checking') : t('loginForm.changePassword')}</button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => { setRecover(false); setMsg(null); }}>{t('loginForm.backToLogin')}</button>
        {msg && <div className="msg msg--error">{msg}</div>}
      </form>
    );
  }

  if (preToken) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="muted" style={{ lineHeight: 1.5 }}>{t('loginForm.passkeyPrompt')}</div>
        <button type="button" disabled={loading} className="btn btn--primary btn--lg btn--block" onClick={() => passkeyStep(preToken)}>
          <Icon name="check" strokeWidth={2.2} />
          {loading ? t('loginForm.waiting') : t('loginForm.confirmWithKey')}
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => { setPreToken(null); setMsg(null); }}>{t('loginForm.backToPassword')}</button>
        {msg && <div className="msg msg--error">{msg}</div>}
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {canPasskey && ed.available('passkeys') && (
        <>
          <button type="button" disabled={loading} className="btn btn--primary btn--lg btn--block" onClick={passkeyDirect}>
            <Icon name="check" strokeWidth={2.2} />
            {loading ? t('loginForm.waiting') : t('loginForm.passkeySignIn')}
          </button>
          <div className="muted" style={{ textAlign: 'center', fontSize: 13 }}>{t('loginForm.orPassword')}</div>
        </>
      )}
      {/* for password managers: they save a password under a name, nobody types this one */}
      <input type="text" name="username" autoComplete="username" value="MedControl" readOnly hidden />
      <div className="field">
        <label htmlFor="password">{t('loginForm.password')}</label>
        <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" autoFocus required />
      </div>
      <button type="submit" disabled={loading} className={`btn btn--lg btn--block ${canPasskey ? 'btn--secondary' : 'btn--primary'}`} style={{ marginTop: 6 }}>
        <Icon name="check" strokeWidth={2.2} />
        {loading ? t('loginForm.signingIn') : t('loginForm.signInToApp')}
      </button>
      {msg && <div className="msg msg--error">{msg}</div>}
      <button type="button" className="btn btn--ghost btn--sm" onClick={() => { setRecover(true); setMsg(null); }}>{t('loginForm.forgot')}</button>
    </form>
  );
}
