import SettingsSubpage from '../../../ui/SettingsSubpage';
import ProtocolScales from '../../../ui/ProtocolScales';
import { serverT } from '../../../i18n/server';

export default async function ProtocolScalesPage() {
  const t = await serverT('settings');
  return <SettingsSubpage title={t('pages.protocolScales')} back={{ href: '/settings/protocol', label: t('rows.protocol.title') }} intro={t('pages.protocolScalesIntro')}><ProtocolScales /></SettingsSubpage>;
}
