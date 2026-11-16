import SettingsSubpage from '../../ui/SettingsSubpage';
import ProtocolOverview from '../../ui/ProtocolOverview';
import { serverT } from '../../i18n/server';

export default async function ProtocolSettingsPage() {
  const t = await serverT('settings');
  return <SettingsSubpage title={t('rows.protocol.title')} intro={t('pages.protocolIntro')}><ProtocolOverview /></SettingsSubpage>;
}
