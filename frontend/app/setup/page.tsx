import BrandLogo from '../ui/BrandLogo';
import SetupForm from '../ui/SetupForm';
import EditionText from '../ui/EditionText';
import { serverT } from '../i18n/server';

export default async function SetupPage() {
  const common = await serverT('common');
  const t = await serverT('auth');
  return (
    <div className="login-page">
      <div className="login-card">
        <div>
          <BrandLogo alt={common('app.name')} />
          <div className="login-tagline"><EditionText server={t('setupPage.taglineServer')} desktop={t('setupPage.taglineDesktop')} /></div>
        </div>
        <SetupForm />
      </div>
    </div>
  );
}
