import SettingsSubpage from '../../ui/SettingsSubpage';
import McpCard from '../../ui/McpCard';

export default function McpSettingsPage() {
  return (
    <SettingsSubpage titleKey="rows.mcp.title" introKey="pages.mcpIntro">
      <McpCard />
    </SettingsSubpage>
  );
}
