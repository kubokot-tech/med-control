/** Reads /backups/status.json written by the backup sidecar. */
import fs from 'node:fs/promises';
import { available } from './edition.js';
import { createFormat } from '../../../shared/format.js';
import { DEFAULT_TZ } from './dates.js';
import { t } from './i18n.js';

const DEFAULT_FORMAT = createFormat({ timeZone: DEFAULT_TZ });
const FILE = process.env.BACKUP_STATUS_FILE || '/backups/status.json';
export async function backupStatus(language) {
  if (!available('backups')) return null; // the desktop app has no backup service (lib/edition.js)
  try {
    const s = JSON.parse(await fs.readFile(FILE, 'utf8'));
    const ageH = s.ran_at ? (Date.now() - new Date(s.ran_at).getTime()) / 3600000 : null;
    const problems = [];
    if (!s.dump_ok) problems.push(t(language, 'backup.dumpFailed'));
    if (s.mirror?.enabled && s.mirror.state === 'failed') problems.push(t(language, 'backup.mirrorFailed'));
    if (s.cloud?.enabled && s.cloud.state === 'failed') problems.push(t(language, 'backup.cloudFailed'));
    if (s.restore_test?.state === 'failed') problems.push(t(language, 'backup.restoreFailed'));
    if (ageH != null && ageH > 36) problems.push(t(language, 'backup.stale', { hours: Math.round(ageH) }));
    // Not a failure (the copy is made, `ok` and the alarms stay as they are), but it must be seen: the cloud copy is
    // readable at the provider when CLOUD_REMOTE is not an rclone crypt remote (backup-loop.sh writes cloud.crypt).
    const warnings = [];
    if (s.cloud?.enabled && s.cloud.crypt === false) warnings.push(t(language, 'backup.cloudNotEncrypted'));
    return { ...s, ageHours: ageH, problems, warnings, ok: problems.length === 0 };
  } catch { return null; }
}
/** One line about the last backup; the time in `format` (userFormat: the user's zone and clock). */
export function backupLine(s, format = DEFAULT_FORMAT) {
  const say = (key, args) => t(format.language, `backup.${key}`, args);
  if (!s) return say('unknown');
  const when = s.ran_at ? format.date(s.ran_at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '?';
  const mb = (b) => (b ? say('mb', { n: (b / 1048576).toFixed(1) }) : '0');
  const state = (x) => say(!x?.enabled ? 'off' : x.state === 'ok' ? 'ok' : x.state === 'skipped' ? 'skipped' : 'error');
  const restore = s.restore_test?.state && s.restore_test.state !== 'skipped' ? say('restore', { state: say(s.restore_test.state === 'ok' ? 'ok' : 'error') }) : '';
  const warnings = (s.warnings || []).map((text) => say('warning', { text })).join('');
  return say('line', { icon: s.dump_ok ? '✅' : '❌', when, database: mb(s.dump_bytes), files: mb(s.uploads_bytes), mirror: state(s.mirror), cloud: state(s.cloud), restore }) + warnings;
}
