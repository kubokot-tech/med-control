/**
 * When the Telegram reminders come: the main drug's dose reminder, its repeat, and the «no labs for N days» check.
 * Set in Settings → Telegram (app_settings; the repeat «off» when switched off); a value in .env (REMIND_DOSE_AT, REMIND_DOSE_AGAIN_AT, LAB_STALE_DAYS)
 * wins and is shown as fixed there. Times are in the user's time zone (Settings → «Язык и регион»).
 */
import { getSetting, setSetting } from './settings.js';
import { invalid } from './errors.js';

const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DEFAULTS = { doseAt: '11:00', doseAgainAt: '20:00', labStaleDays: 28 };
const FIELDS = {
  doseAt: { env: 'REMIND_DOSE_AT', key: 'remind_dose_at' },
  doseAgainAt: { env: 'REMIND_DOSE_AGAIN_AT', key: 'remind_dose_again_at' },
  labStaleDays: { env: 'LAB_STALE_DAYS', key: 'lab_stale_days' },
};

const envValue = (name) => String(process.env[name] || '').trim();

/** { doseAt, doseAgainAt ('' = no repeat), labStaleDays, fromEnv: [field names fixed by .env] } */
export function reminderTimes() {
  const out = { fromEnv: [] };
  for (const [field, { env, key }] of Object.entries(FIELDS)) {
    const e = envValue(env);
    const stored = getSetting(key);
    const raw = e || (stored != null ? String(stored) : '');
    if (e) out.fromEnv.push(field);
    if (field === 'labStaleDays') { const n = parseInt(raw, 10); out[field] = Number.isFinite(n) && n > 0 ? n : DEFAULTS.labStaleDays; continue; }
    if (field === 'doseAgainAt' && (e || stored) === 'off') { out[field] = ''; continue; } // the repeat switched off
    out[field] = HM.test(raw) ? raw : DEFAULTS[field];
  }
  return out;
}

/**
 * Save from the settings page: doseAt 'HH:MM', doseAgainAt 'HH:MM' or '' (no repeat), labStaleDays 7–180. Fields fixed
 * in .env are refused (set_in_env). The repeat must come after the first reminder.
 */
export async function saveReminderTimes(input = {}) {
  const cur = reminderTimes();
  for (const field of Object.keys(FIELDS)) if (field in input && cur.fromEnv.includes(field)) throw invalid('set_in_env');
  const doseAt = 'doseAt' in input ? String(input.doseAt || '').trim() : cur.doseAt;
  const again = 'doseAgainAt' in input ? String(input.doseAgainAt || '').trim() : cur.doseAgainAt;
  if (!HM.test(doseAt) || (again && !HM.test(again))) throw invalid('bad_time');
  if (again && again <= doseAt) throw invalid('repeat_before_first');
  let stale = cur.labStaleDays;
  if ('labStaleDays' in input) { stale = Number(input.labStaleDays); if (!Number.isInteger(stale) || stale < 7 || stale > 180) throw invalid('bad_lab_stale_days'); }
  if ('doseAt' in input) await setSetting('remind_dose_at', doseAt);
  if ('doseAgainAt' in input) await setSetting('remind_dose_again_at', again || 'off');
  if ('labStaleDays' in input) await setSetting('lab_stale_days', String(stale));
  return reminderTimes();
}
