'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'use-intl';
import { apiJson, errorRu } from './api';
import { useFormat } from './format';
import RecoveryCode from './RecoveryCode';

type Status = { applicable: boolean; exists: boolean; createdAt: string | null };

/** Settings → sign-in and security: whether a recovery code exists, and a new one (the old one stops working). */
export default function RecoveryCard() {
  const t = useTranslations('settings');
  const f = useFormat();
  const [s, setS] = useState<Status | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);

  const load = () => apiJson<Status>('/api/gateway/auth/recovery').then(setS).catch(() => {});
  useEffect(() => { load(); }, []);
  if (!s?.applicable) return null;

  async function issue() {
    setBusy(true); setErr(null);
    try {
      const j = await apiJson<{ recoveryCode: string }>('/api/gateway/auth/recovery', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
      setFresh(j.recoveryCode); setPassword('');
    } catch (e) { setErr(errorRu(e)); } finally { setBusy(false); }
  }

  return (
    <div className="card meds-card">
      <div className="meds-card__row">
        <div className="card__title">{t('recoveryCard.title')}</div>
        <span className={`pill${s.exists ? '' : ' pill--warning'}`}>{s.exists ? t('recoveryCard.exists') : t('recoveryCard.missing')}</span>
      </div>
      {fresh ? <RecoveryCode code={fresh} onDone={() => { setFresh(null); load(); }} doneLabel={t('recoveryCard.done')} /> : (
        <>
          <div className="muted" style={{ fontSize: 14, lineHeight: 1.5 }}>
            {s.exists
              ? (s.createdAt ? t('recoveryCard.created', { date: f.date(s.createdAt, { day: 'numeric', month: 'long', year: 'numeric' }) }) : t('recoveryCard.createdFirstRun'))
              : t('recoveryCard.none')}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t('recoveryCard.passwordPlaceholder')} autoComplete="current-password" style={{ width: 170 }} aria-label={t('recoveryCard.passwordLabel')} />
            <button type="button" className="btn btn--secondary btn--sm" disabled={busy || !password} onClick={issue}>{s.exists ? t('recoveryCard.createNew') : t('recoveryCard.create')}</button>
          </div>
        </>
      )}
      {err && <div className="msg msg--error">{err}</div>}
    </div>
  );
}
