import BrandLogo from '../ui/BrandLogo';
import { serverT } from '../i18n/server';

export default async function OfflinePage() {
  const common = await serverT('common');
  const t = await serverT('auth');
  return (
    <div className="login-page">
      <div className="login-card" style={{ textAlign: 'center' }}>
        <BrandLogo alt={common('app.name')} />
        <div className="login-tagline">{t('offlinePage.tagline')}</div>
      </div>
    </div>
  );
}
