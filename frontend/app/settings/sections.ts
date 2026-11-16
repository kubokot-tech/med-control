import type { IconName } from '../ui/icons';

/**
 * The rows of the Settings page, grouped. Order lives here, wording in locales/ru/settings.json (`groups`, `rows`);
 * each row opens its own page. `status` names the field of GET /settings/summary that the row shows next to its title (see page.tsx).
 */
export type RowText = 'protocol' | 'anamnesis' | 'refs' | 'telegram' | 'health' | 'ai' | 'mcp' | 'security' | 'locale' | 'export' | 'server' | 'serverDesktop';
export type GroupTitle = 'treatment' | 'connections' | 'you' | 'server' | 'serverDesktop';
export type SettingsRow = { id: string; href: string; icon: IconName; text: RowText; desktop?: RowText };
export type SettingsGroup = { id: string; title: GroupTitle; desktopTitle?: GroupTitle; rows: SettingsRow[] };

export const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    id: 'treatment', title: 'treatment', rows: [
      { id: 'protocol', href: '/settings/protocol', icon: 'meds', text: 'protocol' },
      { id: 'anamnesis', href: '/settings/anamnesis', icon: 'doc', text: 'anamnesis' },
      { id: 'refs', href: '/labs/refs', icon: 'ruler', text: 'refs' },
    ],
  },
  {
    id: 'connections', title: 'connections', rows: [
      { id: 'telegram', href: '/settings/telegram', icon: 'send', text: 'telegram' },
      { id: 'health', href: '/settings/health', icon: 'heart', text: 'health' },
      { id: 'ai', href: '/settings/ai', icon: 'ai', text: 'ai' },
      { id: 'mcp', href: '/settings/mcp', icon: 'server', text: 'mcp' },
    ],
  },
  {
    id: 'you', title: 'you', rows: [
      { id: 'security', href: '/settings/security', icon: 'lock', text: 'security' },
      { id: 'locale', href: '/settings/locale', icon: 'globe', text: 'locale' },
      { id: 'export', href: '/settings/export', icon: 'download', text: 'export' },
    ],
  },
  {
    id: 'server', title: 'server', desktopTitle: 'serverDesktop', rows: [
      { id: 'server', href: '/settings/server', icon: 'server', text: 'server', desktop: 'serverDesktop' },
    ],
  },
];
