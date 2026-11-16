import SettingsSubpage from '../../../ui/SettingsSubpage';
import ProtocolTexts from '../../../ui/ProtocolTexts';
import { serverT } from '../../../i18n/server';

export default async function ProtocolTextsPage() {
  const t = await serverT('settings');
  return <SettingsSubpage title={t('pages.protocolTexts')} back={{ href: '/settings/protocol', label: t('rows.protocol.title') }}><ProtocolTexts /></SettingsSubpage>;
}
