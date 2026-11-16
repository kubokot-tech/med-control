'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'use-intl';
import AlertCard, { type Alert } from '../ui/AlertCard';
import { apiFetch } from '../ui/labUtils';
import EmptyState from '../ui/EmptyState';

export default function AlertsPage() {
  const t = useTranslations('alerts.page');
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const r = await apiFetch('/api/gateway/alerts?status=all');
      if (!r.ok) throw new Error(await r.text());
      setAlerts((await r.json()).alerts || []);
    } catch (e: any) {
      setErr(String(e?.message || e));
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function ack(a: Alert) {
    const r = await apiFetch(`/api/gateway/alerts/${a.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'ACK' }) });
    if (r.ok) load();
  }
  async function recheck() {
    const r = await apiFetch('/api/gateway/alerts/recheck', { method: 'POST' });
    if (r.ok) load();
  }

  const open = (alerts || []).filter((a) => a.status === 'OPEN');
  const rest = (alerts || []).filter((a) => a.status !== 'OPEN');

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-header__title">{t('title')}</h1>
        <p className="page-header__desc">{t('desc')}</p>
      </div>
      {err && <div className="msg msg--error" style={{ marginBottom: 16 }}>{err}</div>}

      <div className="today-section">
        <div className="meds-card__row">
          <div className="section-label">{t('open')}</div>
          <button type="button" className="btn btn--ghost btn--sm" onClick={recheck}>{t('recheck')}</button>
        </div>
        {alerts === null && !err && <div className="skeleton" style={{ height: 76 }} />}
        {alerts && open.length === 0 && (
          <EmptyState icon="bell" title={t('emptyTitle')} description={t('emptyDesc')} />
        )}
        {open.map((a) => <AlertCard key={a.id} alert={a} onAck={ack} />)}
      </div>

      {rest.length > 0 && (
        <div className="today-section" style={{ marginTop: 24 }}>
          <div className="section-label">{t('read')}</div>
          {(showAll ? rest : rest.slice(0, 10)).map((a) => <AlertCard key={a.id} alert={a} />)}
          {rest.length > 10 && !showAll && <button type="button" className="btn btn--secondary btn--block" onClick={() => setShowAll(true)}>{t('showAll', { n: rest.length })}</button>}
        </div>
      )}
    </div>
  );
}
