'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'use-intl';
import { LoginChrome } from './AuthChrome';
import Icon from './icons';
import { deviceMark, getToken, signedIn } from './labUtils';

const STATIC = process.env.NEXT_PUBLIC_STATIC_EXPORT === '1';

declare global {
  interface Window {
    __TAURI_INTERNALS__?: { invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
  }
}

type Code = 'ok' | 'cancel' | 'password' | 'unavailable' | 'failed';

function askFace(reason: string, fallback: string): Promise<Code> {
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  if (!invoke) return Promise.resolve('unavailable');
  return invoke('face_unlock', { reason, fallback }).then(
    (code) => (code === 'ok' || code === 'cancel' || code === 'password' || code === 'unavailable' || code === 'failed' ? code : 'failed'),
    () => 'failed' as Code,
  );
}

/**
 * On the iPad build, a remembered session still has to pass Face ID before the history is shown.
 * The password remains the way in when Face ID is cancelled, missing, or locked out.
 * This is a privacy screen, not a security boundary: the gateway and the session token live in the same
 * page, so anyone with developer tools can reach them without the lock. The device passcode is the boundary.
 */
export default function FaceLock({ children }: { children: React.ReactNode }) {
  const t = useTranslations('auth');
  const [phase, setPhase] = useState<'check' | 'locked' | 'open'>(STATIC ? 'check' : 'open');
  const [passwordMode, setPasswordMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [round, setRound] = useState(0);

  useEffect(() => {
    if (!STATIC) return;
    if (!getToken()) { setPhase('open'); return; }
    setPhase('locked');
    const onVis = () => {
      if (document.visibilityState === 'hidden') {
        setPhase('locked');
        setPasswordMode(false);
        setMsg(null);
      } else {
        setRound((n) => n + 1);
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  useEffect(() => {
    if (phase !== 'locked' || passwordMode || document.visibilityState === 'hidden') return;
    let gone = false;
    setBusy(true);
    setMsg(null);
    askFace(t('faceLock.reason'), t('faceLock.fallback')).then((code) => {
      if (gone) return;
      setBusy(false);
      if (code === 'ok') setPhase('open');
      else if (code === 'password' || code === 'unavailable') {
        setPasswordMode(true);
        if (code === 'unavailable') setMsg(t('faceLock.unavailable'));
      } else if (code === 'failed') setMsg(t('faceLock.failed'));
      else setMsg(t('faceLock.cancelled'));
    });
    return () => { gone = true; };
  }, [phase, passwordMode, round, t]);

  async function onPassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
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
      if (!r.ok) { setMsg(t('loginForm.invalid')); return; }
      const j = await r.json();
      if (!j.token) { setMsg(t('loginForm.invalid')); return; }
      signedIn(j);
      setPassword('');
      setPhase('open');
    } catch {
      setMsg(t('connectionError'));
    } finally {
      setBusy(false);
    }
  }

  if (phase === 'open') return <>{children}</>;

  return (
    <div className="login-page" style={{ position: 'fixed', inset: 0, zIndex: 200 }}>
      <div className="login-card">
        <LoginChrome />
        {passwordMode ? (
          <form onSubmit={onPassword} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="field">
              <label htmlFor="face-password">{t('loginForm.password')}</label>
              <input id="face-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" autoFocus required />
            </div>
            <button type="submit" disabled={busy || !password} className="btn btn--primary btn--lg btn--block">
              <Icon name="check" strokeWidth={2.2} />
              {busy ? t('loginForm.signingIn') : t('loginForm.signInToApp')}
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => { setPasswordMode(false); setMsg(null); setRound((n) => n + 1); }}>{t('faceLock.back')}</button>
            {msg && <div className="msg msg--error">{msg}</div>}
          </form>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <button type="button" disabled={busy} className="btn btn--primary btn--lg btn--block" onClick={() => setRound((n) => n + 1)}>
              <Icon name="check" strokeWidth={2.2} />
              {busy ? t('faceLock.opening') : t('faceLock.open')}
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => { setPasswordMode(true); setMsg(null); }}>{t('faceLock.usePassword')}</button>
            {msg && <div className="msg msg--error">{msg}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
