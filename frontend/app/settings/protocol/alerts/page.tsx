import SettingsSubpage from '../../../ui/SettingsSubpage';
import ProtocolAlerts from '../../../ui/ProtocolAlerts';

export default function ProtocolAlertsPage() {
  return <SettingsSubpage titleKey="pages.protocolAlerts" backHref="/settings/protocol" backKey="rows.protocol.title" introKey="pages.protocolAlertsIntro" introOffFeature="telegram" introOffKey="pages.protocolAlertsIntroDevice"><ProtocolAlerts /></SettingsSubpage>;
}
