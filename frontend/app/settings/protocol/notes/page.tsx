import SettingsSubpage from '../../../ui/SettingsSubpage';
import ProtocolNotes from '../../../ui/ProtocolNotes';

export default function ProtocolNotesPage() {
  return <SettingsSubpage titleKey="pages.protocolNotes" backHref="/settings/protocol" backKey="rows.protocol.title" introKey="pages.protocolNotesIntro"><ProtocolNotes /></SettingsSubpage>;
}
