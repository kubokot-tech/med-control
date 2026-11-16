'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'use-intl';
import { startRegistration, browserSupportsWebAuthn } from '@simplewebauthn/browser';
import Icon from './icons';
import { apiFetch } from './labUtils';
import PasswordChange from './PasswordChange';
import { useFormat } from './format';
import { useEdition } from './edition';
import ServerOnly from './ServerOnly';

type Passkey = { id: string; name: string; deviceType: string | null; backedUp: boolean; createdAt: string; lastUsedAt: string | null };
type Resp = { passkeys: Passkey[]; mfaEnabled: boolean; rpID: string; origins: string[] };

function deviceName(fallback: string) {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Android/.test(ua)) return 'Android';
  if (/Windows/.test(ua)) return 'Windows';
  return fallback;
}

export default function PasskeysCard() {
  const t = useTranslations('settings');
  const ed = useEdition();
  const f = useFormat();
  const fmt = (iso: string) => f.date(iso, { day: 'numeric', month: 'short', year: 'numeric' });
  const [data, setData] = useState<Resp | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [removing, setRemoving] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [supported, setSupported] = useState(true);
  const [secure, setSecure] = useState(true);

  const load = useCallback(async () => {
    const r = await apiFetch('/api/gateway/auth/passkeys');
    if (r.ok) setData(await r.json());
  }, []);
  useEffect(() => {
    load();
    setSupported(browserSupportsWebAuthn());
    setSecure(window.isSecureContext);
    setName(deviceName(t('passkeysCard.device')));
  }, [load]);

  const hostMismatch = data && typeof window !== 'undefined' && window.location.hostname !== data.rpID;

  async function add() {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const pw = window.prompt(t('passkeysCard.passwordPrompt'));
      if (!pw) return;
      const o = await apiFetch('/api/gateway/auth/passkey/register/options', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) });
      if (o.status === 403) { setErr(t('passkeysCard.wrongPassword')); return; }
      if (!o.ok) throw new Error(await o.text());
      const options = await o.json();
      let response;
      try {
        response = await startRegistration({ optionsJSON: options });
      } catch (e: any) {
        if (e?.name === 'NotAllowedError') { setErr(t('passkeysCard.cancelled')); return; }
        if (e?.name === 'InvalidStateError') { setErr(t('passkeysCard.alreadyRegistered')); return; }
        throw e;
      }
      const v = await apiFetch('/api/gateway/auth/passkey/register/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ response, name }),
      });
      if (!v.ok) throw new Error((await v.json().catch(() => ({}))).message || 'verify');
      setMsg(t('passkeysCard.added'));
      await load();
    } catch (e: any) { setErr(t('passkeysCard.addFailed', { error: String(e?.message || e) })); } finally { setBusy(false); }
  }

  async function remove(id: string) {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await apiFetch(`/api/gateway/auth/passkeys/${encodeURIComponent(id)}`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }),
      });
      if (r.status === 403) { setErr(t('passkeysCard.wrongPassword')); return; }
      if (!r.ok) throw new Error(await r.text());
      setRemoving(null); setPassword('');
      setMsg(t('passkeysCard.removed'));
      await load();
    } catch (e: any) { setErr(String(e?.message || e)); } finally { setBusy(false); }
  }

  // desktop: sign-in is by password only; passkeys stay visible as a server feature (lib/edition.js)
  if (!ed.available('passkeys')) {
    return (
      <>
        <div className="card meds-card">
          <div className="card__title">{t('passkeysCard.password')}</div>
          <PasswordChange />
        </div>
        <ServerOnly title={t('passkeysCard.serverOnlyTitle')} feature="passkeys" />
      </>
    );
  }
  const keys = data?.passkeys || [];
  return (
    <div className="card meds-card">
      <div className="meds-card__row">
        <div className="card__title">{t('passkeysCard.title')}</div>
        <span className={`pill ${keys.length ? 'ok' : ''}`}>{!data ? '…' : !data.mfaEnabled ? t('passkeysCard.mfaOff') : keys.length ? t('passkeysCard.twoFactors') : t('passkeysCard.passwordOnly')}</span>
      </div>
      <div className="muted" style={{ fontSize: 14, lineHeight: 1.5 }}>
        {t('passkeysCard.intro')}
      </div>
      {err && <div className="msg msg--error">{err}</div>}
      {msg && <div className="msg msg--ok">{msg}</div>}
      {!supported && <div className="msg msg--error">{t('passkeysCard.unsupported')}</div>}
      {supported && !secure && <div className="msg msg--error">{t('passkeysCard.httpsOnly')}</div>}
      {supported && secure && hostMismatch && <div className="msg msg--error">{t('passkeysCard.hostMismatch', { domain: data!.rpID })}</div>}

      {keys.length > 0 && (
        <div className="sheet__list">
          {keys.map((k) => (
            <div key={k.id} className="list-row">
              <span>
                <b>{k.name}</b>{k.backedUp ? ` · ${t('passkeysCard.backedUp')}` : ''}
                <br /><span className="muted" style={{ fontSize: 13 }}>{k.lastUsedAt ? t('passkeysCard.addedAtUsed', { date: fmt(k.createdAt), last: fmt(k.lastUsedAt) }) : t('passkeysCard.addedAt', { date: fmt(k.createdAt) })}</span>
              </span>
              {removing === k.id ? (
                <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <input type="password" placeholder={t('passkeysCard.passwordPlaceholder')} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" style={{ width: 150 }} />
                  <button type="button" className="btn btn--danger btn--sm" disabled={busy || !password} onClick={() => remove(k.id)}>{t('passkeysCard.remove')}</button>
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => { setRemoving(null); setPassword(''); }}>{t('passkeysCard.cancel')}</button>
                </span>
              ) : (
                <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => { setRemoving(k.id); setErr(null); }}>{t('passkeysCard.remove')}</button>
              )}
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={async () => { if (!window.confirm(t('passkeysCard.logoutAllConfirm'))) return; const r = await apiFetch('/api/gateway/auth/logout-all', { method: 'POST' }); if (r.ok) { localStorage.removeItem('dtc_token'); window.location.href = '/login'; } }}>{t('passkeysCard.logoutAll')}</button>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('passkeysCard.keyName')} maxLength={60} style={{ width: 180 }} />
        <button type="button" className="btn btn--primary btn--sm" onClick={add} disabled={busy || !supported || !secure || !!hostMismatch}>
          <Icon name="plus" />{t('passkeysCard.add')}
        </button>
      </div>
      <PasswordChange />
      {data && data.mfaEnabled && keys.length > 0 && (
        <details className="settings-more">
          <summary>{t('passkeysCard.lostKeys')}</summary>
          <div className="muted" style={{ fontSize: 13, lineHeight: 1.5, marginTop: 6 }}>
            {t.rich('passkeysCard.lostKeysText', { code: (c) => <code>{c}</code> })}
          </div>
        </details>
      )}
    </div>
  );
}
