import SettingsSubpage from '../../ui/SettingsSubpage';
import AiCard from '../../ui/AiCard';
import { serverT } from '../../i18n/server';

export default async function AiSettingsPage() {
  const t = await serverT('settings');
  return <SettingsSubpage title={t('rows.ai.title')} intro={t('pages.aiIntro')}><AiCard /></SettingsSubpage>;
}
