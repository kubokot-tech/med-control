/** Pure text helpers for the Telegram bot (no DB imports, unit-tested). */
import { createFormat } from '../../../shared/format.js';
import { t } from './i18n.js';
export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A calendar day 'YYYY-MM-DD' in words («5 марта 2026»), in the user's format (userFormat). */
export function fmtDateLong(iso, format = createFormat()) {
  return iso ? format.date(iso, { day: 'numeric', month: 'long', year: 'numeric' }) : '';
}

/** Text of the reply after a PDF is filed, in the language of `format`. Pure, tested. */
export function commitSummary(r, appUrl, format = createFormat()) {
  const say = (key, args) => t(format.language, `bot.commit.${key}`, args);
  const where = [r.labName, fmtDateLong(r.docDate, format)].filter(Boolean).join(', ');
  const link = r.documentId ? `${appUrl}/labs/documents/${r.documentId}` : `${appUrl}/labs`;
  if (r.already) return say('already', { where: where ? ` (${esc(where)})` : '', link });
  const lines = [say('loaded', { where: esc(where || say('labsFallback')) }), say('count', { n: r.inserted })];
  if (r.flagged.length) {
    lines[1] += say('flagged', { n: r.flagged.length });
    for (const f of r.flagged.slice(0, 8)) lines.push(`${f.dir === 'high' ? '↑' : '↓'} ${esc(f.name)} ${esc(f.value)} ${esc(format.unit(f.unit))}`.trim());
    if (r.flagged.length > 8) lines.push(say('andMore', { n: r.flagged.length - 8 }));
  } else if (r.inserted > 0) {
    lines[1] += say('allInRange');
  }
  if (r.alertsRaised) lines.push(say('alerts', { n: r.alertsRaised }));
  lines.push(link);
  return lines.join('\n');
}
