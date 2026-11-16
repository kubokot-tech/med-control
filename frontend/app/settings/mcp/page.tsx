import SettingsSubpage from '../../ui/SettingsSubpage';
import McpCard from '../../ui/McpCard';
import { serverT } from '../../i18n/server';

export default async function McpSettingsPage() {
  const t = await serverT('settings');
  return (
    <SettingsSubpage title={t('rows.mcp.title')} intro={t('pages.mcpIntro')}>
      <McpCard />
    </SettingsSubpage>
  );
}
