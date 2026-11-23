import SettingsSubpage from '../../ui/SettingsSubpage';
import PasskeysCard from '../../ui/PasskeysCard';
import RecoveryCard from '../../ui/RecoveryCard';

export default function SecuritySettingsPage() {
  return <SettingsSubpage titleKey="rows.security.title"><PasskeysCard /><RecoveryCard /></SettingsSubpage>;
}
