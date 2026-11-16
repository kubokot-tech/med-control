import WelcomeFlow from '../ui/WelcomeFlow';
import { serverT } from '../i18n/server';

export async function generateMetadata() {
  const t = await serverT('welcome');
  return { title: t('pageTitle') };
}

export default function WelcomePage() {
  return <WelcomeFlow />;
}
