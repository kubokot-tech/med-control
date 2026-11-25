/**
 * MCP tools (docs/MCP.md): what an AI agent may read and, with a write token, add. Each tool has a JSON schema for the
 * agent, a zod schema that checks the call, and returns plain JSON. Values are in SI units (the catalog unit) and dates
 * are ISO; nothing returns files, secrets or settings. Titles, descriptions and labels in answers follow the language of
 * the token's owner: locales/<language>/server/mcp.json.
 */
import { z } from 'zod';
import { pool } from './db.js';
import { todayKey } from './dates.js';
import { catalog, markerName } from './canonical.js';
import { buildPatientProfile } from './patientProfile.js';
import { listRegimens, listAdministrations } from './meds.js';
import { listAppointments } from './appointments.js';
import { listMilestones } from './milestones.js';
import { imagingOverview } from './imaging.js';
import { listContacts } from './contacts.js';
import { searchAll } from './search.js';
import { rowToEntry } from './symptomRow.js';
import { saveSymptoms } from './symptoms.js';
import { createNote } from './notes.js';
import { doseNote, modalityLabel } from './eventText.js';
import { raw } from './i18n.js';
import { displayUnit } from '../../../shared/units.js';

const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const dayProp = (hint) => ({ type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', hint });
const num = (v) => (v == null ? null : Number(v));
const iso = (d) => (d == null ? null : d instanceof Date ? d.toISOString() : String(d));

export const TOOLS = [
  {
    name: 'get_patient_profile',
    scope: 'read',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    args: z.object({}).strict(),
    run: async (userId, _a, { tz, language }) => ({ profile: await buildPatientProfile(userId, { tz, language }) }),
  },
  {
    name: 'list_lab_markers',
    scope: 'read',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    args: z.object({}).strict(),
    run: async (userId, _a, { language }) => {
      const r = await pool.query(`select t.canonical_key as key, count(*)::int as n, max(r.collected_at) as last
                                  from lab_results r join lab_tests t on t.id = r.test_id where r.user_id = $1 and t.canonical_key is not null group by 1`, [userId]);
      const by = new Map(r.rows.map((x) => [x.key, x]));
      return { markers: catalog(language).map((c) => ({ key: c.key, name: c.name, unit: displayUnit(c.unit, language), category: c.category, results: by.get(c.key)?.n || 0, last: iso(by.get(c.key)?.last) })) };
    },
  },
  {
    name: 'get_lab_results',
    scope: 'read',
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: { key: { type: 'string', hint: 'markerKey' }, from: dayProp('fromIso'), to: dayProp('toInclusive'), limit: { type: 'integer', minimum: 1, maximum: 1000 } },
    },
    args: z.object({ key: z.string().max(20).optional(), from: DAY.optional(), to: DAY.optional(), limit: z.number().int().min(1).max(1000).optional() }).strict(),
    run: async (userId, a, { language }) => {
      const p = [userId]; const w = ['r.user_id = $1'];
      if (a.key) { p.push(a.key); w.push(`t.canonical_key = $${p.length}`); }
      if (a.from) { p.push(a.from); w.push(`r.collected_at >= $${p.length}::date`); }
      if (a.to) { p.push(a.to); w.push(`r.collected_at < ($${p.length}::date + 1)`); }
      p.push(a.limit || 200);
      const r = await pool.query(`select r.collected_at, t.canonical_key as key, t.code, r.value_numeric, r.value_text, r.unit_canonical, r.ref_low, r.ref_high, r.ref_source, r.lab_ref_low, r.lab_ref_high, r.lab_name
                                  from lab_results_eff r join lab_tests t on t.id = r.test_id where ${w.join(' and ')} order by r.collected_at desc limit $${p.length}`, p);
      return { results: r.rows.map((x) => ({ date: iso(x.collected_at), key: x.key, name: x.key ? markerName(x.key, language) : x.code, value: num(x.value_numeric), text: x.value_text, unit: displayUnit(x.unit_canonical, language), refLow: num(x.ref_low), refHigh: num(x.ref_high), refSource: x.ref_source, labRefLow: num(x.lab_ref_low), labRefHigh: num(x.lab_ref_high), lab: x.lab_name })) };
    },
  },
  {
    name: 'get_medications',
    scope: 'read',
    inputSchema: { type: 'object', additionalProperties: false, properties: { days: { type: 'integer', minimum: 1, maximum: 365 } } },
    args: z.object({ days: z.number().int().min(1).max(365).optional() }).strict(),
    run: async (userId, a, { tz, language }) => {
      const to = todayKey(tz); const d = new Date(`${to}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - ((a.days || 30) - 1));
      const [regimens, administrations] = await Promise.all([listRegimens(userId, { tz, language }), listAdministrations(userId, { from: d.toISOString().slice(0, 10), to, tz })]);
      const unit = (x) => ({ ...x, doseUnit: displayUnit(x.doseUnit, language) });
      return { regimens: regimens.map((r) => ({ ...r, items: r.items.map(unit) })), administrations: administrations.map((a) => ({ ...a, notes: doseNote(a.notes, language), doseUnit: displayUnit(a.doseUnit, language) })) };
    },
  },
  {
    name: 'get_diary',
    scope: 'read',
    inputSchema: { type: 'object', additionalProperties: false, properties: { from: dayProp('from'), to: dayProp('toInclusive') } },
    args: z.object({ from: DAY.optional(), to: DAY.optional() }).strict(),
    run: async (userId, a, { tz }) => {
      const to = a.to || todayKey(tz);
      const from = a.from || (() => { const d = new Date(`${to}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - 29); return d.toISOString().slice(0, 10); })();
      const r = await pool.query('select * from symptom_entries where user_id = $1 and date between $2 and $3 order by date desc', [userId, from, to]);
      return { from, to, entries: r.rows.map(rowToEntry) };
    },
  },
  {
    name: 'get_appointments',
    scope: 'read',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    args: z.object({}).strict(),
    run: async (userId) => ({ appointments: await listAppointments(userId) }),
  },
  {
    name: 'get_history',
    scope: 'read',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    args: z.object({}).strict(),
    run: async (userId, _a, { language }) => ({ milestones: (await listMilestones(userId, { language })).map((m) => ({ ...m, attachments: m.attachments.map((f) => ({ filename: f.filename, mimeType: f.mimeType })) })) }),
  },
  {
    name: 'get_imaging',
    scope: 'read',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    args: z.object({}).strict(),
    run: async (userId, _a, { language }) => {
      const o = await imagingOverview(userId, { language });
      return { ...o, studies: o.studies.map((s) => ({ ...s, modality: modalityLabel(s.modality, language) })) };
    },
  },
  {
    name: 'get_contacts',
    scope: 'read',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    args: z.object({}).strict(),
    run: async (userId) => ({ contacts: await listContacts(userId) }),
  },
  {
    name: 'search',
    scope: 'read',
    inputSchema: { type: 'object', additionalProperties: false, required: ['query'], properties: { query: { type: 'string', minLength: 2, maxLength: 200 } } },
    args: z.object({ query: z.string().min(2).max(200) }).strict(),
    run: async (userId, a) => ({ results: (await searchAll(userId, a.query, { limit: 40 })).results.map(({ href: _h, rank: _r, ...x }) => x) }),
  },
  {
    name: 'add_note',
    scope: 'write',
    inputSchema: { type: 'object', additionalProperties: false, required: ['title', 'body'], properties: { title: { type: 'string', maxLength: 200 }, body: { type: 'string', maxLength: 20000 } } },
    args: z.object({ title: z.string().min(1).max(200), body: z.string().min(1).max(20000) }).strict(),
    run: async (userId, a, { tz, language, tokenName, transact }) => {
      const n = await createNote(userId, { title: a.title, body: a.body, tags: [raw(language, 'mcp.noteTag')] }, { tz, sourceName: `MCP: ${tokenName}`, transact });
      return { ok: true, noteId: n.id };
    },
  },
  {
    name: 'add_diary_entry',
    scope: 'write',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['date'],
      properties: {
        date: dayProp('entryDay'), wellbeing: { type: 'integer', minimum: 1, maximum: 5 }, bpSys: { type: 'integer', minimum: 60, maximum: 260 }, bpDia: { type: 'integer', minimum: 30, maximum: 160 },
        pulse: { type: 'integer', minimum: 25, maximum: 250 }, weightKg: { type: 'number', minimum: 20, maximum: 300 }, tempC: { type: 'number', minimum: 34, maximum: 43 }, notes: { type: 'string', maxLength: 2000 },
      },
    },
    args: z.object({
      date: DAY, wellbeing: z.number().int().min(1).max(5).optional(), bpSys: z.number().int().min(60).max(260).optional(), bpDia: z.number().int().min(30).max(160).optional(),
      pulse: z.number().int().min(25).max(250).optional(), weightKg: z.number().min(20).max(300).optional(), tempC: z.number().min(34).max(43).optional(), notes: z.string().max(2000).optional(),
    }).strict(),
    run: async (userId, a, { tz, transact }) => {
      const { date, ...e } = a;
      if (date > todayKey(tz)) return { ok: false, error: 'future_date' };
      const { entry } = await saveSymptoms(userId, date, e, tz, { appendNotes: true, transact });
      return { ok: true, entry };
    },
  },
];

/** A JSON schema with its hints in `language`. */
function schemaIn(schema, language) {
  if (!schema.properties) return schema;
  const props = Object.entries(schema.properties).map(([k, { hint, ...p }]) => [k, hint ? { ...p, description: raw(language, `mcp.args.${hint}`) } : p]);
  return { ...schema, properties: Object.fromEntries(props) };
}
/** What tools/list says about a tool. */
export const toolInfo = (tool, language) => ({ title: raw(language, `mcp.tools.${tool.name}.title`), description: raw(language, `mcp.tools.${tool.name}.description`), inputSchema: schemaIn(tool.inputSchema, language) });

export const toolByName = (name) => TOOLS.find((t) => t.name === name) || null;
/** Tools a token may see and call: read tokens get the read tools, write tokens all of them. */
export const toolsFor = (scope) => TOOLS.filter((t) => t.scope === 'read' || scope === 'write');
