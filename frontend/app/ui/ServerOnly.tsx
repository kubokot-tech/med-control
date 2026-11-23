import { useTranslations } from 'use-intl';

/** Features with a reason why they are missing in this edition: `serverOnly.why` (gateway/src/lib/edition.js, docs/DESKTOP.md). */
const WHY = ['appleHealth', 'dicom', 'backups', 'passkeys', 'egress', 'telegram'] as const;
type Why = typeof WHY[number];
const isWhy = (feature: string): feature is Why => (WHY as readonly string[]).includes(feature);

/** A feature kept in place but switched off in this edition: title, the server-only pill and why. */
export default function ServerOnly({ title, feature }: { title: string; feature: string }) {
  const t = useTranslations('settings');
  return (
    <div className="card meds-card server-only">
      <div className="meds-card__row">
        <div className="card__title">{title}</div>
        <span className="pill">{t('serverOnly.pill')}</span>
      </div>
      <div className="muted" style={{ fontSize: 14, lineHeight: 1.5 }}>{isWhy(feature) ? t(`serverOnly.why.${feature}`) : t('serverOnly.fallback')}</div>
    </div>
  );
}
