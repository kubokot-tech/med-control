import SettingsSubpage from '../../ui/SettingsSubpage';
import BackupCard from '../../ui/BackupCard';
import LabsParsersCard from '../../ui/LabsParsersCard';

export default function ServerSettingsPage() {
  return (
    <SettingsSubpage
      titleKey="rows.server.title"
      titleDesktopKey="rows.serverDesktop.title"
      introKey="pages.serverIntro"
      introDesktopKey="pages.serverIntroDesktop"
    >
      <BackupCard />
      <LabsParsersCard />
    </SettingsSubpage>
  );
}
