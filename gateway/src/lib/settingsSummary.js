/**
 * One look at every Settings section (GET /settings/summary): codes, numbers and dates only, the interface words them
 * (docs/I18N.md). Also what «Требует внимания» and «С чего начать» are built from.
 */
import { pool } from './db.js';
import { getSetting } from './settings.js';
import { presetText, getProtocol, withStatus, currentDiaryScales, SETTING_KEY } from './protocol.js';
import { telegramConfig, telegramReady } from './telegram.js';
import { llmConfig } from './llm.js';
import { countPasskeys } from './passkeys.js';
import { lastImport } from './healthImport.js';
import { backupStatus } from './backupStatus.js';
import { pdfEngine, pdfEngineHealth } from './pdfEngine.js';
import { getUserLocale } from './userLocale.js';
import { recoveryStatus } from './recovery.js';
import { mcpEnabled, mcpDisabledByAdmin } from './mcpAccess.js';
import { editionInfo } from './edition.js';

const pdfState = async () => {
  if (pdfEngine() === 'js') return 'ok';
  try { await pdfEngineHealth(); return 'ok'; } catch { return 'down'; }
};

export async function settingsSummary(userId) {
  const p = withStatus(getProtocol());
  const tg = telegramConfig();
  const ai = llmConfig();
  const health = lastImport();
  const [anamnesisAt, refs, passkeys, backup, pdf, locale, mcpTokens] = await Promise.all([
    pool.query('select max(created_at) as at from anamnesis_versions where user_id = $1', [userId]).then((r) => r.rows[0]?.at || null).catch(() => null),
    pool.query(`select u.sex, (select count(*)::int from lab_ref_overrides o where o.user_id = u.id) as own from users u where u.id = $1`, [userId]).then((r) => r.rows[0] || { sex: null, own: 0 }),
    countPasskeys(userId),
    backupStatus(),
    pdfState(),
    getUserLocale(userId),
    pool.query('select count(*)::int as n from mcp_tokens where user_id = $1 and revoked_at is null', [userId]).then((r) => r.rows[0].n).catch(() => 0),
  ]);
  return {
    protocol: { name: presetText(p.name, locale.language) || null, status: p.status, chosen: Boolean(getSetting(SETTING_KEY)), rules: p.labRules?.length ?? 0, scales: currentDiaryScales().length },
    anamnesis: { filled: Boolean((getSetting('anamnesis') || '').trim()), updatedAt: anamnesisAt },
    refs: { sex: refs.sex ?? null, own: refs.own ?? 0 },
    telegram: { state: telegramReady() ? 'ready' : tg.token ? 'partial' : 'off' },
    health: { state: health ? 'ok' : getSetting('integration_token_created') ? 'waiting' : 'off', lastAt: health?.at || null },
    ai: { state: ai.enabled ? 'ready' : 'off', provider: ai.enabled ? ai.provider : null },
    security: { passkeys, mfa: process.env.DTC_MFA !== 'off', recovery: (({ applicable, exists }) => ({ applicable, exists }))(recoveryStatus()) },
    locale: { language: locale.language, region: locale.prefs.region, timeZone: locale.timeZone },
    backup: { state: !backup ? 'none' : backup.ok ? 'ok' : 'problem', at: backup?.ran_at || null, problems: backup?.problems?.length ?? 0 },
    pdf: { state: pdf },
    edition: editionInfo(),
    mcp: { state: mcpDisabledByAdmin() ? 'blocked' : mcpEnabled() ? 'on' : 'off', tokens: mcpTokens },
  };
}
