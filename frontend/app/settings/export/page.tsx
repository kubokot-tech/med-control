import SettingsSubpage from '../../ui/SettingsSubpage';
import ExportCard from '../../ui/ExportCard';
import ImportCard from '../../ui/ImportCard';

export default function ExportSettingsPage() {
  return <SettingsSubpage titleKey="rows.export.title"><ExportCard /><ImportCard /></SettingsSubpage>;
}
