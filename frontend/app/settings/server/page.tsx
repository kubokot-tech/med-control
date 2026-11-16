import SettingsSubpage from '../../ui/SettingsSubpage';
import BackupCard from '../../ui/BackupCard';
import LabsParsersCard from '../../ui/LabsParsersCard';
import EditionText from '../../ui/EditionText';
import { serverT } from '../../i18n/server';

export default async function ServerSettingsPage() {
  const t = await serverT('settings');
  return (
    <SettingsSubpage
      title={<EditionText server={t('rows.server.title')} desktop={t('rows.serverDesktop.title')} />}
      intro={<EditionText
        server={t('pages.serverIntro')}
        desktop={t('pages.serverIntroDesktop')}
      />}
    >
      <BackupCard />
      <LabsParsersCard />
    </SettingsSubpage>
  );
}
