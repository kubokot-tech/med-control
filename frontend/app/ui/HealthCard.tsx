'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'use-intl';
import { apiFetch } from './labUtils';
import { errorRu } from './api';
import { useFormat } from './format';
import { useEdition } from './edition';
import ServerOnly from './ServerOnly';

type Health = { lastImport: { at: string; samples: number; days: number; alertsRaised?: number } | null; kinds: { kind: string; n: number; last: string }[]; keyCreated: string | null; endpoint: string };

/** Apple Health kinds with a name in `healthCard.kind`. */
const KIND_HEALTH: Record<string, 'bloodPressure' | 'weight' | 'bodyTemperature' | 'heartRate' | 'restingHeartRate' | 'steps'> = { blood_pressure: 'bloodPressure', weight_body_mass: 'weight', body_temperature: 'bodyTemperature', heart_rate: 'heartRate', resting_heart_rate: 'restingHeartRate', step_count: 'steps' };

/** Apple Health through Health Auto Export: key, what arrived, setup steps (folded once data comes). */
export default function HealthCard() {
  const t = useTranslations('settings');
  const ed = useEdition();
  const f = useFormat();
  const [health, setHealth] = useState<Health | null>(null);
  const [healthKey, setHealthKey] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState('');

  const load = async () => { const r = await apiFetch('/api/gateway/health/status'); if (r.ok) setHealth(await r.json()); };
  useEffect(() => { load(); }, []);

  async function makeKey() {
    if (health?.keyCreated && !confirm(t('healthCard.newKeyConfirm'))) return;
    setBusy(true); setErr(null);
    try {
      const r = await apiFetch('/api/gateway/auth/integration-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
      if (!r.ok) throw new Error(errorRu(await r.json().catch(() => ({}))));
      setHealthKey((await r.json()).token); setPassword('');
      await load();
    } catch (e: any) { setErr(String(e?.message || e)); } finally { setBusy(false); }
  }
  async function revoke() {
    if (!confirm(t('healthCard.revokeConfirm'))) return;
    await apiFetch('/api/gateway/auth/integration-token', { method: 'DELETE' });
    setHealthKey(null);
    await load();
  }

  const steps = (
    <ol className="settings-steps">
      <li>{t('healthCard.step1')}</li>
      <li>{t('healthCard.step2')}</li>
      <li>{t.rich('healthCard.step3', { endpoint: health?.endpoint || '…/api/gateway/health/import', code: (c) => <code>{c}</code> })}</li>
      <li>{t('healthCard.step4')}</li>
      <li>{t('healthCard.step5')}</li>
    </ol>
  );

  if (!ed.available('appleHealth')) return <ServerOnly title="Apple Health" feature="appleHealth" />;

  return (
    <div className="card meds-card">
      <div className="meds-card__row">
        <div className="card__title">Apple Health</div>
        <span className={`pill ${health?.lastImport ? 'ok' : ''}`}>{health?.lastImport ? t('healthCard.dataComes') : health?.keyCreated ? t('healthCard.waiting') : t('healthCard.notConnected')}</span>
      </div>
      <div className="muted" style={{ fontSize: 14, lineHeight: 1.5 }}>{t('healthCard.intro')}</div>
      {health?.lastImport && <div style={{ fontSize: 14 }}>{health.lastImport.alertsRaised
        ? t('healthCard.lastDataAlerts', { date: f.date(health.lastImport.at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }), days: health.lastImport.days, alerts: health.lastImport.alertsRaised })
        : t('healthCard.lastData', { date: f.date(health.lastImport.at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }), days: health.lastImport.days })}</div>}
      {health && health.kinds.length > 0 && <div className="muted" style={{ fontSize: 13 }}>{health.kinds.map((k) => t('healthCard.kindUntil', { kind: KIND_HEALTH[k.kind] ? t(`healthCard.kind.${KIND_HEALTH[k.kind]}`) : k.kind, date: f.date(k.last, { day: 'numeric', month: 'short' }) })).join(' · ')}</div>}
      {healthKey && <div className="msg msg--ok" style={{ wordBreak: 'break-all' }}>{t.rich('healthCard.keyOnce', { key: healthKey, code: (c) => <code>{c}</code> })}</div>}
      {health && (health.lastImport ? <details className="settings-more"><summary>{t('healthCard.howToSetUp')}</summary>{steps}</details> : steps)}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t('healthCard.passwordPlaceholder')} autoComplete="current-password" style={{ width: 170 }} aria-label={t('healthCard.passwordLabel')} />
        <button type="button" className={`btn ${health?.keyCreated ? 'btn--secondary' : 'btn--primary'} btn--sm`} onClick={makeKey} disabled={busy || !password}>{health?.keyCreated ? t('healthCard.newKey') : t('healthCard.createKey')}</button>
        {health?.keyCreated && <button type="button" className="btn btn--ghost btn--sm" onClick={revoke} disabled={busy}>{t('healthCard.revoke')}</button>}
      </div>
      {err && <div className="msg msg--error">{err}</div>}
      <div className="muted" style={{ fontSize: 13 }}>{t('healthCard.history')}</div>
    </div>
  );
}
