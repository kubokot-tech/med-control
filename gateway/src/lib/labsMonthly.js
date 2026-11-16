/**
 * Monthly AI review of all lab results in a month (blood + urine together),
 * with six months of history per marker and the patient profile. The review is
 * stored in ai_comments (subject labs_month) and mirrored as a milestone so it
 * appears in the history, the Today feed and the doctor report.
 */
import { pool, transaction } from './db.js';
import { markerName, keyKeys } from './canonical.js';
import { llmChat } from './llm.js';
import { aiFormat, aiNumber } from './aiFormat.js';
import { patientPrompt, prompt } from './aiPrompts.js';
import { buildPatientProfile, aiDay, localYmd } from './patientProfile.js';
import { DEFAULT_TZ } from './dates.js';
import { addEvent, updateEvent } from './feed.js';
import { refText } from './labsQuery.js';
import { kindLabel } from './eventText.js';
import { userLanguage } from './userLocale.js';
import { t } from './i18n.js';
import { LANGUAGES } from '../../../shared/format.js';
import { displayUnit } from '../../../shared/units.js';

/** «март 2026», «March 2026». */
export const monthTitle = (ym, language) => `${aiFormat(language).months('long')[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

/** Months that have lab results, newest first: ['2026-02', …]. */
export async function monthsWithLabs(userId) {
  const r = await pool.query(
    `select to_char(collected_at, 'YYYY-MM') as ym, count(*)::int as n from lab_results where user_id = $1 group by 1 order by 1 desc`,
    [userId]
  );
  return r.rows;
}

export async function buildMonthContext(userId, ym, language) {
  const say = (key, args) => t(language, `aiContext.monthly.${key}`, args);
  const fmt = (n) => aiNumber(n, 3, language);
  const dateRu = (d) => aiDay(d, language);
  const unit = (u) => displayUnit(u, language) || '';
  const from = `${ym}-01`;
  const results = (await pool.query(
    `select t.code, t.canonical_key as key, t.category, r.collected_at, r.value_numeric, r.value_text, r.unit_canonical as unit, r.ref_low, r.ref_high, r.lab_name
       from lab_results_eff r join lab_tests t on t.id = r.test_id
      where r.user_id = $1 and r.collected_at >= $2::date and r.collected_at < ($2::date + interval '1 month')
      order by t.category, t.canonical_key nulls last, t.code, r.collected_at`,
    [userId, from]
  )).rows;
  if (!results.length) return null;

  const keys = [...new Set(results.map((r) => r.key).filter(Boolean))];
  const hist = (await pool.query(
    `select t.canonical_key as key, r.collected_at, r.value_numeric, r.unit_canonical as unit
       from lab_results_eff r join lab_tests t on t.id = r.test_id
      where r.user_id = $1 and t.canonical_key = any($2) and r.value_numeric is not null
        and r.collected_at >= ($3::date - interval '6 months') and r.collected_at < $3::date
      order by t.canonical_key, r.collected_at`,
    [userId, keys, from]
  )).rows;
  const histByKey = new Map();
  for (const h of hist) { if (!histByKey.has(h.key)) histByKey.set(h.key, []); histByKey.get(h.key).push(h); }

  // Key markers for this therapy that were not measured this month: last values within a year, for trends.
  const missingKeys = keyKeys().filter((k) => !keys.includes(k));
  const lastKnown = missingKeys.length ? (await pool.query(
    `select * from (
       select t.canonical_key as key, r.collected_at, r.value_numeric, r.unit_canonical as unit, r.ref_low, r.ref_high,
              row_number() over (partition by t.canonical_key order by r.collected_at desc) as rn
         from lab_results_eff r join lab_tests t on t.id = r.test_id
        where r.user_id = $1 and t.canonical_key = any($2) and r.value_numeric is not null
          and r.collected_at >= ($3::date - interval '12 months') and r.collected_at < $3::date
     ) x where rn <= 3 order by key, collected_at`,
    [userId, missingKeys, from]
  )).rows : [];
  const lastByKey = new Map();
  for (const h of lastKnown) { if (!lastByKey.has(h.key)) lastByKey.set(h.key, []); lastByKey.get(h.key).push(h); }

  const lines = [];
  const labs = [...new Set(results.map((r) => r.lab_name).filter(Boolean))];
  const dates = [...new Set(results.map((r) => dateRu(r.collected_at)))];
  lines.push(say('head', { month: monthTitle(ym, language), n: results.length, dates: dates.join(', '), labs: labs.length ? say('labs', { list: labs.join(', ') }) : '' }));
  lines.push('');
  let flagged = 0;
  for (const cat of ['blood', 'urine', 'other']) {
    const rows = results.filter((r) => (r.category || 'other') === cat || (cat === 'other' && !['blood', 'urine'].includes(r.category)));
    if (!rows.length) continue;
    lines.push(say(cat === 'blood' ? 'blood' : cat === 'urine' ? 'urine' : 'other'));
    for (const r of rows) {
      const name = r.key ? markerName(r.key, language) : r.code;
      const v = r.value_numeric != null ? fmt(r.value_numeric) : (r.value_text || '');
      const ref = r.ref_low != null && r.ref_high != null ? `${fmt(r.ref_low)}–${fmt(r.ref_high)}` : r.ref_low != null ? `≥${fmt(r.ref_low)}` : r.ref_high != null ? `≤${fmt(r.ref_high)}` : '';
      let flag = '';
      if (r.value_numeric != null) {
        if (r.ref_high != null && Number(r.value_numeric) > Number(r.ref_high)) { flag = say('high'); flagged++; }
        else if (r.ref_low != null && Number(r.value_numeric) < Number(r.ref_low)) { flag = say('low'); flagged++; }
        else if (ref) flag = t(language, 'aiContext.labs.normal');
      }
      lines.push(`${name} | ${dateRu(r.collected_at)} | ${v} | ${unit(r.unit)} | ${ref} | ${flag}`);
    }
    lines.push('');
  }
  if (histByKey.size) {
    lines.push(say('history'));
    for (const [k, xs] of histByKey) lines.push(`${markerName(k, language)}: ` + xs.map((h) => `${dateRu(h.collected_at)} ${fmt(h.value_numeric)}`).join('; ') + ` ${unit(xs[0].unit)}`.trimEnd());
  }
  if (lastByKey.size) {
    lines.push('');
    lines.push(say('lastKnown'));
    for (const [k, xs] of lastByKey) {
      const ref = refText(xs[0].ref_low, xs[0].ref_high) ? t(language, 'aiContext.reference', { ref: refText(xs[0].ref_low, xs[0].ref_high, fmt) }) : '';
      lines.push(`${markerName(k, language)}: ` + xs.map((h) => `${dateRu(h.collected_at)} ${fmt(h.value_numeric)}`).join('; ') + ` ${unit(xs[0].unit)}${ref}`.trimEnd());
    }
  }
  return { text: lines.join('\n'), resultCount: results.length, flagged, dates: dates.length, lastDate: results.map((r) => r.collected_at).sort().pop() };
}

/** Run the review for a month, store it, upsert the milestone. */
export async function reviewLabsMonth(userId, ym, { tz = DEFAULT_TZ } = {}) {
  const language = await userLanguage(userId);
  const ctx = await buildMonthContext(userId, ym, language);
  if (!ctx) return null;
  const say = (key, args) => t(language, `aiContext.monthly.${key}`, args);
  const profile = await buildPatientProfile(userId, { tz, language });
  const user = `${profile ? `${t(language, 'aiContext.ask.patientData')}\n${profile}\n\n` : ''}${say('section')}\n${ctx.text}\n\n${say('ask', { month: monthTitle(ym, language) })}`;
  const out = await llmChat({ system: patientPrompt(language, 'monthly'), user, maxTokens: 2000, tier: 'main', language });
  const text = out.text.trim();
  if (!text) { const e = new Error('empty answer'); e.code = 'bad_output'; throw e; }

  return transaction(async (client) => {
    const c = await client.query(
      'insert into ai_comments (user_id, subject_type, subject_id, model, text, usage, context) values ($1,$2,$3,$4,$5,$6,$7) returning id, model, text, usage, created_at, context',
      [userId, 'labs_month', ym, out.model, text, JSON.stringify(out.usage || {}), `${out.promptTag}\n${user}`]
    );
    // Milestone dated by the last result of the month; the feed shows only the first paragraph.
    const date = ctx.lastDate instanceof Date ? localYmd(ctx.lastDate) : String(ctx.lastDate).slice(0, 10);
    const titleIn = (l) => t(l, 'aiContext.monthly.title', { month: monthTitle(ym, l) });
    const title = titleIn(language);
    const eventTitle = `${kindLabel('ai_review', language)}: ${title}`;
    const lead = new RegExp(`^${prompt(language, 'monthlyLead')}\\.\\s*`);
    const summary = text.split('\n').map((s) => s.trim()).filter(Boolean)[0]?.replace(lead, '').slice(0, 400) || '';
    // the month's review stays one milestone, whichever language wrote it last
    const existing = await client.query(`select id, event_id from milestones where user_id = $1 and kind = 'ai_review' and title = any($2::text[]) limit 1`, [userId, LANGUAGES.map(titleIn)]);
    if (existing.rows.length) {
      const m = existing.rows[0];
      await client.query('update milestones set date = $3, notes = $4, title = $5, updated_at = now() where id = $1 and user_id = $2', [m.id, userId, date, text, title]);
      if (m.event_id) await updateEvent(client, userId, m.event_id, { type: 'MILESTONE', date, tz, title: eventTitle, notes: summary, meta: { kind: 'ai_review', tone: 'neutral', ym } });
    } else {
      const evId = await addEvent(client, userId, { type: 'MILESTONE', date, tz, title: eventTitle, notes: summary, meta: { kind: 'ai_review', tone: 'neutral', ym }, source: 'ai' });
      await client.query(
        `insert into milestones (user_id, event_id, date, kind, tone, title, notes) values ($1,$2,$3,'ai_review','neutral',$4,$5)`,
        [userId, evId, date, title, text]
      );
    }
    return { ...c.rows[0], ym, title, resultCount: ctx.resultCount, flagged: ctx.flagged };
  });
}
