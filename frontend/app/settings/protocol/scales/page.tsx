import SettingsSubpage from '../../../ui/SettingsSubpage';
import ProtocolScales from '../../../ui/ProtocolScales';

export default function ProtocolScalesPage() {
  return <SettingsSubpage titleKey="pages.protocolScales" backHref="/settings/protocol" backKey="rows.protocol.title" introKey="pages.protocolScalesIntro"><ProtocolScales /></SettingsSubpage>;
}
