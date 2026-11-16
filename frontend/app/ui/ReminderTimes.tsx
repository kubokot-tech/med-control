'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'use-intl';
import { apiJson, errorRu } from './api';

export type Schedule = { doseAt: string; doseAgainAt: string; labStaleDays: number; fromEnv?: string[] };

/**
 * Settings → Telegram: when the main drug's reminder and its repeat come, and after how many days without labs to
 * remind (gateway lib/reminderTimes.js). In the user's time zone; values fixed in .env are shown, not edited.
 */
export default function ReminderTimes({ schedule, onSaved }: { schedule: Schedule; onSaved: () => void }) {
  const t = useTranslations('settings');
  const [v, setV] = useState({ doseAt: schedule.doseAt, again: schedule.doseAgainAt, stale: String(schedule.labStaleDays) });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setV({ doseAt: schedule.doseAt, again: schedule.doseAgainAt, stale: String(schedule.labStaleDays) }); }, [schedule.doseAt, schedule.doseAgainAt, schedule.labStaleDays]);
  const env = new Set(schedule.fromEnv || []);
  const dirty = v.doseAt !== schedule.doseAt || v.again !== schedule.doseAgainAt || v.stale !== String(schedule.labStaleDays);

  async function save() {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const body: Record<string, unknown> = {};
      if (!env.has('doseAt')) body.doseAt = v.doseAt;
      if (!env.has('doseAgainAt')) body.doseAgainAt = v.again;
      if (!env.has('labStaleDays')) body.labStaleDays = Number(v.stale);
      await apiJson('/api/gateway/notify/schedule', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      setMsg(t('reminderTimes.saved'));
      onSaved();
    } catch (e) { setErr(errorRu(e)); } finally { setBusy(false); }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="section-label">{t('reminderTimes.title')}</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label className="field" style={{ flex: '0 1 150px' }}><span>{t('reminderTimes.dose')}</span><input type="time" value={v.doseAt} disabled={env.has('doseAt')} onChange={(e) => setV({ ...v, doseAt: e.target.value })} /></label>
        <label className="field" style={{ flex: '0 1 150px' }}><span>{t('reminderTimes.again')}</span><input type="time" value={v.again} disabled={env.has('doseAgainAt')} onChange={(e) => setV({ ...v, again: e.target.value })} /></label>
        {!env.has('doseAgainAt') && v.again && <button type="button" className="btn btn--ghost btn--sm" onClick={() => setV({ ...v, again: '' })}>{t('reminderTimes.noRepeat')}</button>}
        <label className="field" style={{ flex: '0 1 190px' }}><span>{t('reminderTimes.staleDays')}</span><input inputMode="numeric" value={v.stale} disabled={env.has('labStaleDays')} onChange={(e) => setV({ ...v, stale: e.target.value.replace(/\D/g, '') })} /></label>
      </div>
      <div className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
        {t('reminderTimes.hint')}
        {env.size > 0 && <>{' '}{t('reminderTimes.envHint')}</>}
      </div>
      <div><button type="button" className="btn btn--primary btn--sm" onClick={save} disabled={busy || !dirty || !v.doseAt}>{busy ? t('reminderTimes.saving') : t('reminderTimes.save')}</button></div>
      {msg && !dirty && <div className="msg msg--ok">{msg}</div>}
      {err && <div className="msg msg--error">{err}</div>}
    </div>
  );
}
