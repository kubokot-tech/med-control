/**
 * What the full data export («Скачать все данные», routes/export.js) leaves out of the table dumps: secret settings
 * (API keys, the bot token, the password hash) and hash columns of tokens. The archive is not encrypted and is
 * meant to be copied around, so nothing in it may let someone sign in or spend the user's AI account.
 */
import { isSecretSetting } from './config.js';

const HASH_COLUMN = /(^|_)hash$/i;

export function scrubTable(table, rows) {
  if (table === 'app_settings') return rows.filter((r) => !isSecretSetting(r.key));
  if (!rows.length || !Object.keys(rows[0]).some((c) => HASH_COLUMN.test(c))) return rows;
  return rows.map((r) => Object.fromEntries(Object.entries(r).filter(([c]) => !HASH_COLUMN.test(c))));
}
