import SettingsSubpage from '../../ui/SettingsSubpage';
import ProtocolOverview from '../../ui/ProtocolOverview';

export default function ProtocolSettingsPage() {
  return <SettingsSubpage titleKey="rows.protocol.title" introKey="pages.protocolIntro"><ProtocolOverview /></SettingsSubpage>;
}
