'use client';

import Link from 'next/link';
import { useTranslations } from 'use-intl';
import Icon from './icons';
import { useFormat } from './format';

export type Alert = {
  id: string;
  triggeredAt: string;
  status: 'OPEN' | 'ACK' | 'RESOLVED' | string;
  scope: string;
  key: string;
  severity: 'RED' | 'YELLOW' | string;
  message: string;
  href: string | null;
  date: string | null;
};

export default function AlertCard({ alert, onAck, compact = false }: { alert: Alert; onAck?: (a: Alert) => void; compact?: boolean }) {
  const f = useFormat();
  const t = useTranslations('alerts.card');
  const danger = alert.severity === 'RED';
  const when = f.date(alert.triggeredAt, { day: 'numeric', month: 'long' });
  const body = (
    <>
      <Icon name="warn" />
      <div className="event-card__body">
        <div className="attention-card__title">{alert.message}</div>
        <div className="attention-card__sub">
          {danger ? t('important') : t('watch')} · {when}
          {alert.status !== 'OPEN' ? ` · ${alert.status === 'ACK' ? t('acked') : t('closed')}` : ''}
        </div>
        {onAck && alert.status === 'OPEN' && (
          <div style={{ marginTop: 8 }}>
            <button type="button" className="btn btn--secondary btn--sm" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onAck(alert); }}>{t('ack')}</button>
            {alert.href && !compact && <Link href={alert.href} className="btn btn--ghost btn--sm" style={{ marginLeft: 6 }}>{t('open')}</Link>}
          </div>
        )}
      </div>
      {compact && alert.href && <Icon name="chevron" size={20} className="event-card__chevron" />}
    </>
  );
  const cls = `attention-card ${danger ? 'attention-card--danger' : ''} ${alert.status !== 'OPEN' ? 'attention-card--muted' : ''}`;
  return compact && alert.href ? <Link href={alert.href} className={cls}>{body}</Link> : <div className={cls}>{body}</div>;
}
