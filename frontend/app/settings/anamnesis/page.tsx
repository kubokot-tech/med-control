import SettingsSubpage from '../../ui/SettingsSubpage';
import ProfileCard from '../../ui/ProfileCard';
import PatientCard from '../../ui/PatientCard';

export default function AnamnesisSettingsPage() {
  return <SettingsSubpage titleKey="rows.anamnesis.title" introKey="pages.anamnesisIntro"><PatientCard /><ProfileCard /></SettingsSubpage>;
}
