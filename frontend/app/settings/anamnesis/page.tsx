import SettingsSubpage from '../../ui/SettingsSubpage';
import ProfileCard from '../../ui/ProfileCard';
import PatientCard from '../../ui/PatientCard';
import { serverT } from '../../i18n/server';

export default async function AnamnesisSettingsPage() {
  const t = await serverT('settings');
  return <SettingsSubpage title={t('rows.anamnesis.title')} intro={t('pages.anamnesisIntro')}><PatientCard /><ProfileCard /></SettingsSubpage>;
}
