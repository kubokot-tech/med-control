import SettingsSubpage from '../../../ui/SettingsSubpage';
import ProtocolTexts from '../../../ui/ProtocolTexts';

export default function ProtocolTextsPage() {
  return <SettingsSubpage titleKey="pages.protocolTexts" backHref="/settings/protocol" backKey="rows.protocol.title"><ProtocolTexts /></SettingsSubpage>;
}
