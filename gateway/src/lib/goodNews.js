/**
 * Good news for the home screen: the app mostly shows what is wrong (out of range, missed doses), so it also says
 * when things went well. Within the last GOOD_NEWS_DAYS days:
 *  - the latest milestone the user marked as good news (tone positive), e.g. «КТ: частичный ответ»;
 *  - a key marker back in range: its latest result is within the reference and the one before was not.
 * Data only (codes, dates, the user's own titles); the frontend words it from the dictionary.
 */
import { pool } from './db.js';
import { keyKeys, markerShort } from './canonical.js';
import { milestoneTitle } from './eventText.js';
import { userLanguage } from './userLocale.js';
import { flag } from './labsQuery.js';
import { addDays, dayKey, todayKey, DEFAULT_TZ } from './dates.js';

export const GOOD_NEWS_DAYS = 60;

/**
 * milestones: [{ id, date, kind, tone, title }]; labs: [{ key, date, value, refLow, refHigh }] in time order per key.
 * → [{ id, kind: 'milestone' | 'labNormal', date, … }], newest first, at most three.
 */
export function goodNewsFrom({ milestones = [], labs = [], today, days = GOOD_NEWS_DAYS, language }) {
  const since = addDays(today, -days);
  const out = [];
  const m = milestones
    .filter((x) => x.tone === 'positive' && x.kind !== 'ai_review' && x.date >= since && x.date <= today)
    .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  if (m) out.push({ id: `ms:${m.id}`, kind: 'milestone', date: m.date, title: milestoneTitle(m.kind, m.title, language), milestoneId: m.id });
  const byKey = new Map();
  for (const r of labs) { if (!byKey.has(r.key)) byKey.set(r.key, []); byKey.get(r.key).push(r); }
  for (const [key, rows] of byKey) {
    if (rows.length < 2) continue;
    const last = rows[rows.length - 1];
    const prev = rows[rows.length - 2];
    if (last.date < since || last.date > today) continue;
    const was = flag(prev.value, prev.refLow, prev.refHigh, prev.valueText);
    if (flag(last.value, last.refLow, last.refHigh, last.valueText) === 'ok' && (was === 'high' || was === 'low')) {
      out.push({ id: `lab:${key}:${last.date}`, kind: 'labNormal', date: last.date, key, short: markerShort(key, language), was });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 3);
}

export async function goodNews(userId, tz = DEFAULT_TZ) {
  const today = todayKey(tz);
  const since = addDays(today, -GOOD_NEWS_DAYS);
  const [ms, labs] = await Promise.all([
    pool.query(`select id, date::text as date, kind, tone, title from milestones where user_id = $1 and tone = 'positive' and date >= $2::date order by date desc limit 5`, [userId, since]),
    // the last two results of each key marker, against the ranges in force (lab_results_eff)
    pool.query(
      `select key, collected_at, value_numeric, value_text, ref_low, ref_high from (
         select t.canonical_key as key, r.collected_at, r.value_numeric, r.value_text, r.ref_low, r.ref_high,
                row_number() over (partition by t.canonical_key order by r.collected_at desc) as n
         from lab_results_eff r join lab_tests t on t.id = r.test_id
         where r.user_id = $1 and t.canonical_key = any($2::text[]) and r.value_numeric is not null) x
       where n <= 2 order by key, collected_at`,
      [userId, keyKeys()],
    ),
  ]);
  return goodNewsFrom({
    language: await userLanguage(userId),
    milestones: ms.rows,
    labs: labs.rows.map((r) => ({ key: r.key, date: dayKey(r.collected_at, tz), value: Number(r.value_numeric), valueText: r.value_text, refLow: r.ref_low, refHigh: r.ref_high })),
    today,
  });
}
