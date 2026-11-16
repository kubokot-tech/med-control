'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'use-intl';
import { apiFetch } from './labUtils';
import type { NotifyStatus } from './TelegramCard';
import { useFormat } from './format';
import { useEdition } from './edition';
import ServerOnly from './ServerOnly';

type Tier = { enabled?: boolean; state?: string } | undefined;

/** Night backups as the backup service reports them (for the server administrator). */
export default function BackupCard() {
  const t = useTranslations('settings');
  const tier = (x: Tier) => (!x?.enabled ? t('backupCard.tierOff') : x.state === 'ok' ? t('backupCard.tierOk') : x.state === 'skipped' ? t('backupCard.tierSkipped') : t('backupCard.error'));
  const ed = useEdition();
  const f = useFormat();
  const [backup, setBackup] = useState<NotifyStatus['backup'] | undefined>(undefined);
  const [dir, setDir] = useState<string | null>(null);
  useEffect(() => { apiFetch('/api/gateway/notify/status').then(async (r) => { if (r.ok) { const j = await r.json(); setBackup(j.backup ?? null); setDir(j.backupDir ?? null); } }); }, []);

  const b = (backup || {}) as NonNullable<NotifyStatus['backup']> & { dump_ok?: boolean; dump_bytes?: number; uploads_bytes?: number };
  const mb = (n?: number) => t('backupCard.mb', { n: n ? f.number(n / 1048576, { maximumFractionDigits: 1 }) : '0' });

  if (!ed.available('backups')) return <ServerOnly title={t('backupCard.title')} feature="backups" />;

  return (
    <div className="card meds-card">
      <div className="meds-card__row">
        <div className="card__title">{t('backupCard.title')}</div>
        <span className={`pill ${backup ? (backup.ok ? 'ok' : 'pill--danger') : ''}`}>{backup === undefined ? '…' : !backup ? t('backupCard.noData') : backup.ok ? t('backupCard.allOk') : t('backupCard.problems')}</span>
      </div>
      {backup ? (
        <>
          <div className="sheet__list" style={{ fontSize: 14 }}>
            {[
              ...(dir ? [[t('backupCard.dir'), dir.startsWith('../') ? t('backupCard.dirNear', { dir }) : dir]] : []),
              [t('backupCard.last'), backup.ran_at ? f.date(backup.ran_at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'],
              [t('backupCard.database'), b.dump_ok ? `${mb(b.dump_bytes)}` : t('backupCard.error')],
              [t('backupCard.files'), mb(b.uploads_bytes)],
              [t('backupCard.mirror'), tier(backup.mirror)],
              [t('backupCard.cloud'), tier(backup.cloud)],
              [t('backupCard.restoreTest'), !backup.restore_test?.state || backup.restore_test.state === 'skipped' ? t('backupCard.sundays') : backup.restore_test.state === 'ok' ? t('backupCard.tierOk') : t('backupCard.error')],
            ].map(([k, v]) => <div key={k} className="list-row"><span>{k}</span><span className={v === t('backupCard.error') ? 'settings-row__sub--warn' : 'muted'}>{v}</span></div>)}
          </div>
          {!backup.mirror?.enabled && !backup.cloud?.enabled && <div className="msg msg--warning">{t.rich('backupCard.sameDisk', { code: (c) => <code>{c}</code> })}</div>}
          {(backup.warnings || []).map((w) => <div key={w} className="msg msg--warning">{w}</div>)}
          {!backup.ok && <div className="msg msg--error">{t('backupCard.problemsList', { problems: backup.problems.length ? backup.problems.join('; ') : t('backupCard.seeAbove') })}</div>}
        </>
      ) : backup === null && <div className="muted" style={{ fontSize: 14 }}>{t('backupCard.noReport')}</div>}
      <details className="settings-more">
        <summary>{t('backupCard.howTitle')}</summary>
        <div className="muted" style={{ fontSize: 13, lineHeight: 1.5, marginTop: 6 }}>{t.rich('backupCard.how', { code: (c) => <code>{c}</code> })}</div>
      </details>
    </div>
  );
}
