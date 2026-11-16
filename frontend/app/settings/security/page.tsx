import SettingsSubpage from '../../ui/SettingsSubpage';
import PasskeysCard from '../../ui/PasskeysCard';
import RecoveryCard from '../../ui/RecoveryCard';
import { serverT } from '../../i18n/server';

export default async function SecuritySettingsPage() {
  const t = await serverT('settings');
  return <SettingsSubpage title={t('rows.security.title')}><PasskeysCard /><RecoveryCard /></SettingsSubpage>;
}
