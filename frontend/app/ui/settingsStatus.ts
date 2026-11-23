/** Wording of the Settings summary (GET /settings/summary): row statuses and the attention list. */
import type { useTranslations } from 'use-intl';
import type { Format } from '../../../shared/format.js';

/** GET /settings/summary: codes and numbers per section (gateway/src/lib/settingsSummary.js). */
export type SettingsSummary = {
  protocol: { name: string | null; status: 'ready' | 'example' | 'custom'; chosen: boolean; rules: number; scales: number };
  anamnesis: { filled: boolean; updatedAt: string | null };
  refs: { sex: 'm' | 'f' | null; own: number };
  telegram: { state: 'ready' | 'partial' | 'off' };
  health: { state: 'ok' | 'waiting' | 'off'; lastAt: string | null };
  ai: { state: 'ready' | 'off'; provider: string | null };
  security: { passkeys: number; mfa: boolean; recovery?: { applicable: boolean; exists: boolean } };
  locale: { language: string; region: string; timeZone: string };
  backup: { state: 'ok' | 'problem' | 'none'; at: string | null; problems: number };
  pdf: { state: 'ok' | 'down' };
  mcp: { state: 'on' | 'off' | 'blocked'; tokens: number };
  edition: { edition: 'server' | 'desktop'; unavailable: string[] };
};

/** The translator of the `settings` dictionary (locales/ru/settings.json). */
export type SettingsT = ReturnType<typeof useTranslations<'settings'>>;

type Tone = 'ok' | 'warn' | 'muted';
const PROVIDER_RU: Record<string, string> = { openrouter: 'OpenRouter', anthropic: 'Anthropic' };

/** The status line of a row, worded here from the summary codes; null keeps the row's hint. */
export function rowStatus(id: string, s: SettingsSummary, f: Format, t: SettingsT): { text: string; tone: Tone } | null {
  const off = (feature: string) => s.edition?.unavailable?.includes(feature);
  const day = (d: string | null) => (d ? f.date(d, { day: 'numeric', month: 'short' }) : '');
  switch (id) {
    case 'protocol': return { text: [s.protocol.name, t(`status.protocol.${s.protocol.status}`)].filter(Boolean).join(' · '), tone: 'muted' };
    case 'anamnesis': return s.anamnesis.filled ? { text: s.anamnesis.updatedAt ? t('status.anamnesisUpdated', { date: day(s.anamnesis.updatedAt) }) : t('status.anamnesisFilled'), tone: 'muted' } : { text: t('status.anamnesisEmpty'), tone: 'muted' };
    case 'refs': return { text: t('status.refs', { sex: s.refs.sex || 'none', own: s.refs.own }), tone: 'muted' };
    case 'telegram':
      if (off('telegram')) return { text: t('status.serverOnly'), tone: 'muted' };
      return s.telegram.state === 'ready' ? { text: t('status.telegramReady'), tone: 'ok' } : s.telegram.state === 'partial' ? { text: t('status.telegramPartial'), tone: 'warn' } : { text: t('status.telegramOff'), tone: 'muted' };
    case 'health': if (off('appleHealth')) return { text: t('status.serverOnly'), tone: 'muted' };
      return s.health.state === 'ok' ? { text: t('status.healthOk', { date: day(s.health.lastAt) }), tone: 'ok' } : s.health.state === 'waiting' ? { text: t('status.healthWaiting'), tone: 'muted' } : { text: t('status.healthOff'), tone: 'muted' };
    case 'ai': return s.ai.state === 'ready' ? { text: t('status.aiReady', { provider: String(PROVIDER_RU[s.ai.provider || ''] || s.ai.provider) }), tone: 'ok' } : { text: t('status.aiOff'), tone: 'muted' };
    case 'security': if (off('passkeys')) return { text: t('status.passwordSignIn'), tone: 'muted' };
      return { text: s.security.passkeys ? t('status.passkeys', { n: s.security.passkeys }) : t('status.passwordOnly'), tone: 'muted' };
    case 'locale': {
      const region = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames([s.locale.language], { type: 'region' }).of(s.locale.region) : s.locale.region;
      return { text: `${region} · ${f.date(new Date())} · ${s.locale.timeZone}`, tone: 'muted' };
    }
    case 'mcp': return s.mcp.state === 'on' ? { text: t('status.mcpOn', { n: s.mcp.tokens }), tone: 'warn' } : { text: s.mcp.state === 'blocked' ? t('status.mcpBlocked') : t('status.mcpOff'), tone: 'muted' };
    case 'server':
      if (s.backup.state === 'problem' || s.pdf.state === 'down') return { text: t('status.serverProblems'), tone: 'warn' };
      if (off('backups')) return { text: t('status.backupsServerOnly'), tone: 'muted' };
      return s.backup.state === 'ok' ? { text: t('status.backupAt', { date: f.date(s.backup.at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) }), tone: 'ok' } : { text: t('status.backupNone'), tone: 'muted' };
    default: return null;
  }
}

/** Things that are broken (not merely not set up): each a line with a link. */
export function attention(s: SettingsSummary, t: SettingsT): { text: string; href: string }[] {
  const out: { text: string; href: string }[] = [];
  if (s.backup.state === 'problem') out.push({ text: t('attention.backup'), href: '/settings/server' });
  if (s.pdf.state === 'down') out.push({ text: t('attention.pdf'), href: '/settings/server' });
  if (s.security.recovery?.applicable && !s.security.recovery.exists) out.push({ text: t('attention.recovery'), href: '/settings/security' });
  if (s.telegram.state === 'partial' && !s.edition?.unavailable?.includes('telegram')) out.push({ text: t('attention.telegram'), href: '/settings/telegram' });
  return out;
}


/** The «getting started» checklist: the four things worth setting up first. Apple Health and passkeys are optional and not here. */
export function setupSteps(s: SettingsSummary, t: SettingsT): { id: string; title: string; why: string; href: string; done: boolean }[] {
  const steps = [
    { id: 'protocol', title: t('setup.protocol.title'), why: t('setup.protocol.why'), href: '/settings/protocol', done: s.protocol.chosen },
    { id: 'anamnesis', title: t('setup.anamnesis.title'), why: t('setup.anamnesis.why'), href: '/settings/anamnesis', done: s.anamnesis.filled },
    { id: 'ai', title: t('setup.ai.title'), why: t('setup.ai.why'), href: '/settings/ai', done: s.ai.state === 'ready' },
    { id: 'telegram', title: t('setup.telegram.title'), why: t('setup.telegram.why'), href: '/settings/telegram', done: s.telegram.state === 'ready' },
  ];
  return s.edition?.unavailable?.includes('telegram') ? steps.filter((step) => step.id !== 'telegram') : steps;
}
