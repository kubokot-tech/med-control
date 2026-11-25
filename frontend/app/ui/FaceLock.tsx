'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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

  const dialog = useRef<HTMLDialogElement>(null);
  const generation = useRef(0);
  const [hasOpened, setHasOpened] = useState(false);
  function unlock() { setHasOpened(true); setPhase('open'); }

  useLayoutEffect(() => {
    // A modal is in the browser's top layer, including when an editor already has a dialog open.
    if (phase !== 'open' && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [phase]);

  useEffect(() => {
    if (!STATIC) return;
    if (getToken()) setPhase('locked');
    else unlock();
    const onVis = () => {
      if (!getToken()) return;
      if (document.visibilityState === 'hidden') {
        generation.current++;
        setBusy(false);
        setPassword('');
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
    const attempt = generation.current;
    let gone = false;
    setBusy(true);
    setMsg(null);
    askFace(t('faceLock.reason'), t('faceLock.fallback')).then((code) => {
      if (gone || attempt !== generation.current || document.hidden) return;
      setBusy(false);
      if (code === 'ok') unlock();
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
    const attempt = generation.current;
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
      if (attempt !== generation.current || document.hidden) return;
      signedIn(j);
      setPassword('');
      unlock();
    } catch {
      setMsg(t('connectionError'));
    } finally {
      setBusy(false);
    }
  }

  if (!STATIC) return <>{children}</>;

  return (
    <>
      {hasOpened && <div hidden={phase !== 'open'} inert={phase !== 'open'} style={phase === 'open' ? { display: 'contents' } : undefined}>{children}</div>}
      {phase !== 'open' && <dialog ref={dialog} data-mc-locked className="login-page" onCancel={(e) => e.preventDefault()} style={{ position: 'fixed', inset: 0, margin: 0, border: 0, width: '100%', maxWidth: 'none', height: '100%', maxHeight: 'none' }}>
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
      </dialog>}
    </>
  );
}
