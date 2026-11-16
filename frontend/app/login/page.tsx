import BrandLogo from '../ui/BrandLogo';
import LoginForm from '../ui/LoginForm';
import { serverT } from '../i18n/server';

export default async function LoginPage() {
  const common = await serverT('common');
  const t = await serverT('auth');
  return (
    <div className="login-page">
      <div className="login-card">
        <div>
          <BrandLogo alt={common('app.name')} />
          <div className="login-tagline">{t('loginPage.title')}</div>
          <div className="login-desc">{t('loginPage.description')}</div>
          <div className="login-desc login-desc--short">{t('loginPage.descriptionShort')}</div>
        </div>
        <LoginForm />
      </div>
    </div>
  );
}
