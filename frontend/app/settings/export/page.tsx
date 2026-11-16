import SettingsSubpage from '../../ui/SettingsSubpage';
import ExportCard from '../../ui/ExportCard';
import ImportCard from '../../ui/ImportCard';
import { serverT } from '../../i18n/server';

export default async function ExportSettingsPage() {
  const t = await serverT('settings');
  return <SettingsSubpage title={t('rows.export.title')}><ExportCard /><ImportCard /></SettingsSubpage>;
}
