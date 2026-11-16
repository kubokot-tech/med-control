import SettingsSubpage from '../../ui/SettingsSubpage';
import LocaleCard from '../../ui/LocaleCard';
import { serverT } from '../../i18n/server';

export default async function LocaleSettingsPage() {
  const t = await serverT('settings');
  return <SettingsSubpage title={t('rows.locale.title')}><LocaleCard /></SettingsSubpage>;
}
