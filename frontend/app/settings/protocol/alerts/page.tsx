import SettingsSubpage from '../../../ui/SettingsSubpage';
import ProtocolAlerts from '../../../ui/ProtocolAlerts';
import { serverT } from '../../../i18n/server';

export default async function ProtocolAlertsPage() {
  const t = await serverT('settings');
  return <SettingsSubpage title={t('pages.protocolAlerts')} back={{ href: '/settings/protocol', label: t('rows.protocol.title') }} intro={t('pages.protocolAlertsIntro')}><ProtocolAlerts /></SettingsSubpage>;
}
