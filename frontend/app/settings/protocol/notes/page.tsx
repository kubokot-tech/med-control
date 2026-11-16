import SettingsSubpage from '../../../ui/SettingsSubpage';
import ProtocolNotes from '../../../ui/ProtocolNotes';
import { serverT } from '../../../i18n/server';

export default async function ProtocolNotesPage() {
  const t = await serverT('settings');
  return <SettingsSubpage title={t('pages.protocolNotes')} back={{ href: '/settings/protocol', label: t('rows.protocol.title') }} intro={t('pages.protocolNotesIntro')}><ProtocolNotes /></SettingsSubpage>;
}
