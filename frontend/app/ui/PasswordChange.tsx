'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'use-intl';
import { apiFetch, MIN_PASSWORD } from './labUtils';
import { errorRu } from './api';

/** Change the password set by the first-run wizard; hidden when the password lives in .env. */
export default function PasswordChange() {
  const t = useTranslations('settings');
  const [source, setSource] = useState<'env' | 'settings' | 'none' | null>(null);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [next2, setNext2] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { apiFetch('/api/gateway/auth/password').then(async (r) => { if (r.ok) setSource((await r.json()).source); }); }, []);
  if (!source) return null;
  if (source === 'env') return <div className="muted" style={{ fontSize: 13 }}>{t.rich('passwordChange.fromEnv', { code: (c) => <code>{c}</code> })}</div>;

  const ok = current.length > 0 && next.length >= MIN_PASSWORD && next === next2 && !busy;
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ok) return;
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await apiFetch('/api/gateway/auth/password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ current, next }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(errorRu(j));
      localStorage.setItem('dtc_token', j.token);
      // the «known device» mark given before stopped with the old password: keep the new one
      try { if (j.device) localStorage.setItem('dtc_device', j.device); } catch { /* private mode */ }
      setCurrent(''); setNext(''); setNext2('');
      setMsg(t('passwordChange.changed'));
    } catch (e: any) { setErr(String(e?.message || e)); } finally { setBusy(false); }
  }

  return (
    <details>
      <summary className="muted" style={{ cursor: 'pointer', fontSize: 14 }}>{t('passwordChange.title')}</summary>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
        <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} placeholder={t('passwordChange.current')} autoComplete="current-password" />
        <input type="password" value={next} onChange={(e) => setNext(e.target.value)} placeholder={t('passwordChange.next')} autoComplete="new-password" />
        <input type="password" value={next2} onChange={(e) => setNext2(e.target.value)} placeholder={t('passwordChange.next2')} autoComplete="new-password" />
        {next2.length > 0 && next !== next2 && <div className="muted" style={{ fontSize: 13 }}>{t('passwordChange.mismatch')}</div>}
        <div><button type="submit" className="btn btn--primary btn--sm" disabled={!ok}>{busy ? t('passwordChange.saving') : t('passwordChange.submit')}</button></div>
        {err && <div className="msg msg--error">{err}</div>}
        {msg && <div className="msg msg--ok">{msg}</div>}
      </form>
    </details>
  );
}
