/**
 * Treatment protocol: what the alerts, the AI prompts, the infusion catalog and the regimen seed know
 * about the therapy. Stored as JSON in app_settings (key `treatment_protocol`); when nothing is stored,
 * the default preset applies. Presets are examples recorded by one patient, not clinical standards
 * (see DISCLAIMER.md); the UI lets the user pick one and edit thresholds and texts.
 */
import { z } from 'zod';
import { getSetting, setSetting } from './settings.js';
import { CATALOG_SEED } from './catalogSeed.js';
import { PRESETS, presetsIn, presetText, currentPresetText } from './protocolPresets.js';
import { SCALE_KEYS, DEFAULT_SCALES } from './diaryScales.js';
import { DEFAULT_LANGUAGE } from '../../../shared/format.js';
import { t } from './i18n.js';

export const SETTING_KEY = 'treatment_protocol';
// until the user picks one (first-run wizard or Settings): general lab control, not a drug-specific preset
export const DEFAULT_PRESET = 'generic';

export { PRESETS, BASE_LAB_RULES, presetText, presetVariants } from './protocolPresets.js';

const CATALOG_KEYS = new Set(CATALOG_SEED.map((e) => e.key));
const catalogKey = z.string().min(1).max(20).refine((k) => CATALOG_KEYS.has(k), { message: 'unknown catalog key' });

export const RuleSchema = z.object({
  key: catalogKey,
  severity: z.enum(['RED', 'YELLOW']),
  op: z.enum(['lt', 'lte', 'gt', 'gte', 'gtRef', 'ltRef']),
  value: z.number().finite(),
  message: z.string().min(1).max(300),
});
const AgentSchema = z.object({
  name: z.string().min(1).max(120), shortName: z.string().max(40).nullable().optional(),
  defaultDose: z.number().finite().nullable().optional(), doseUnit: z.string().max(20).nullable().optional(),
  notes: z.string().max(600).nullable().optional(), sortOrder: z.number().int().min(0).max(1000).optional(),
});
const RegimenSchema = z.object({
  name: z.string().min(1).max(120), form: z.string().max(40).nullable().optional(), role: z.enum(['systemic', 'support']).default('systemic'),
  doseValue: z.number().positive().nullable().optional(), doseUnit: z.string().max(20).nullable().optional(),
  timesPerDay: z.number().int().min(1).max(6).default(1), instructions: z.string().max(1000).nullable().optional(),
  frequencyRule: z.enum(['DAILY', 'WEEKLY', 'EVERY_N_DAYS']).default('DAILY'),
  scheduleDays: z.array(z.number().int().min(1).max(7)).max(7).nullable().optional(),
  intervalDays: z.number().int().min(2).max(90).nullable().optional(),
});
export const ProtocolSchema = z.object({
  preset: z.string().max(40).nullable().default(null),
  name: z.string().min(1).max(120),
  status: z.enum(['ready', 'example', 'custom']).default('custom'),
  summary: z.string().max(600).default(''),
  aiNotes: z.string().max(4000).default(''),
  labCadenceHint: z.string().max(300).default(''),
  labRules: z.array(RuleSchema).max(80).default([]),
  regimen: RegimenSchema.nullable().default(null),
  infusionAgents: z.array(AgentSchema).max(40).default([]),
  markerNotes: z.record(z.string(), z.string().max(600)).default({}),
  // Diary scales shown on the symptoms page, in this order. Missing in protocols saved before 0.2: taken from the preset.
  diaryScales: z.array(z.string().refine((k) => SCALE_KEYS.includes(k), { message: 'unknown diary scale' })).max(20).optional(),
});

/** Fill fields older stored protocols lack (diaryScales) from their preset, or the default list; a reworded preset summary takes its current words. */
export function normalizeProtocol(stored) {
  const p = { ...stored, summary: currentPresetText(stored.summary) };
  if (Array.isArray(p.diaryScales)) return { ...p, diaryScales: [...new Set(p.diaryScales)] };
  const preset = p.preset ? PRESETS.find((x) => x.id === p.preset) : null;
  return { ...p, diaryScales: preset?.diaryScales ? [...preset.diaryScales] : [...DEFAULT_SCALES] };
}

export function presetById(id) {
  return PRESETS.find((p) => p.id === id) || null;
}
/** Preset as a protocol object (preset id recorded so the UI can show its status). */
export function protocolFromPreset(id) {
  const p = presetById(id);
  if (!p) return null;
  const { id: pid, ...rest } = p;
  return normalizeProtocol(ProtocolSchema.parse({ ...rest, preset: pid }));
}
/** Short list for the picker, in `language`. */
export function listPresets(language) {
  return presetsIn(language).map((p) => ({ id: p.id, name: p.name, status: p.status, summary: p.summary }));
}
/**
 * The protocol with its preset texts in `language`; what the user wrote stays as written (docs/I18N.md, rule 8).
 * Preset texts are stored in Russian whatever the interface language, the way units are stored in one form: the words
 * change on the way to the screen, and an English screen saved back (setProtocol) still matches its preset.
 */
export function protocolIn(p, language) {
  const x = (s) => (typeof s === 'string' ? presetText(s, language) : s);
  return {
    ...p, name: x(p.name), summary: x(p.summary), aiNotes: x(p.aiNotes), labCadenceHint: x(p.labCadenceHint),
    labRules: p.labRules.map((r) => ({ ...r, message: x(r.message) })),
    regimen: p.regimen && { ...p.regimen, name: x(p.regimen.name), doseUnit: x(p.regimen.doseUnit), instructions: x(p.regimen.instructions) },
    infusionAgents: p.infusionAgents.map((a) => ({ ...a, name: x(a.name), shortName: x(a.shortName), doseUnit: x(a.doseUnit), notes: x(a.notes) })),
    markerNotes: Object.fromEntries(Object.entries(p.markerNotes).map(([k, v]) => [k, x(v)])),
  };
}
/** Diary scales of the current protocol. */
export function currentDiaryScales() {
  return getProtocol().diaryScales;
}

let cached = null; // { raw, protocol }
/** Current protocol: stored JSON if valid, otherwise the default preset. Cheap: reads the settings cache. */
export function getProtocol() {
  const raw = getSetting(SETTING_KEY);
  if (cached && cached.raw === raw) return cached.protocol;
  let protocol = null;
  if (raw) {
    try { protocol = normalizeProtocol(ProtocolSchema.parse(JSON.parse(raw))); } catch { protocol = null; }
  }
  if (!protocol) protocol = protocolFromPreset(DEFAULT_PRESET);
  cached = { raw, protocol };
  return protocol;
}
/**
 * Loading another preset keeps the diary scales the user switched on beyond their previous preset: the new preset's
 * scales plus those, at most 20 (the schema's limit).
 */
export function mergePresetScales(next, current) {
  const before = current?.preset ? protocolFromPreset(current.preset)?.diaryScales || [] : [];
  const own = (current?.diaryScales || []).filter((k) => !before.includes(k));
  return { ...next, diaryScales: [...new Set([...(next.diaryScales || []), ...own])].slice(0, 20) };
}

/** Status is the preset's while the content still matches it, `custom` otherwise (diary scales are a preference and do not count). */
export function withStatus(protocol) {
  const preset = protocol.preset ? protocolFromPreset(protocol.preset) : null;
  const same = preset && JSON.stringify({ ...protocol, status: '', diaryScales: [] }) === JSON.stringify({ ...preset, status: '', diaryScales: [] });
  return { ...protocol, status: same ? preset.status : 'custom' };
}
/** Validate and store, preset texts in Russian (protocolIn). Throws ZodError on bad input. */
export async function setProtocol(input) {
  const protocol = withStatus(normalizeProtocol(protocolIn(ProtocolSchema.parse(input), DEFAULT_LANGUAGE)));
  await setSetting(SETTING_KEY, JSON.stringify(protocol));
  cached = null;
  const { invalidateProfileCache } = await import('./patientProfile.js');
  invalidateProfileCache();
  return protocol;
}
/** Rules for alerts.js; `rules` argument lets pure tests bypass settings. */
export function currentLabRules() {
  return getProtocol().labRules;
}
/** Line for the AI profile in `language`, or '' when the protocol has nothing to say. */
export function protocolPromptLine(language) {
  const p = protocolIn(getProtocol(), language);
  const notes = (p.aiNotes || '').trim();
  return notes ? t(language, 'aiContext.profile.protocol', { name: p.name, notes }) : '';
}
