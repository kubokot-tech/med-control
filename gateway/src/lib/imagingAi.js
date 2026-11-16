/** AI commentary on one imaging study, and the stored text of a structured parse. */
import { pool } from './db.js';
import { llmChat } from './llm.js';
import { patientPrompt } from './aiPrompts.js';
import { buildPatientProfile } from './patientProfile.js';
import { attachedImages, subjectContext, studyImages } from './aiAsk.js';
import { responseLabel } from './recist.js';
import { userLanguage } from './userLocale.js';
import { t } from './i18n.js';

export async function commentImagingStudy(userId, studyId, { tz } = {}) {
  const language = await userLanguage(userId);
  const ctx = await subjectContext(userId, 'imaging_study', studyId, language);
  if (!ctx) return null;
  const say = (key, args) => t(language, `aiContext.imaging.${key}`, args);
  const [profile, images] = await Promise.all([buildPatientProfile(userId, { tz, language }), studyImages(userId, studyId)]);
  const userText = `${t(language, 'aiContext.ask.patientData')}\n${profile}\n\n${say('section')}\n${ctx.text}${images.length ? `\n\n${attachedImages(images, language)}` : ''}\n\n${say('ask')}`;
  const out = await llmChat({ system: patientPrompt(language, 'imagingComment'), user: userText, images, maxTokens: 2500, tier: 'fast', language });
  const text = out.text.trim();
  if (!text) { const e = new Error('empty answer'); e.code = 'bad_output'; throw e; }
  const r = await pool.query(
    'insert into ai_comments (user_id, subject_type, subject_id, model, text, usage, context) values ($1,$2,$3,$4,$5,$6,$7) returning id, model, text, usage, created_at, context',
    [userId, 'imaging_study', studyId, out.model, text, JSON.stringify(out.usage || {}), `${out.promptTag}\n${userText}`]
  );
  return r.rows[0];
}

/** Human-readable text of a structured report parse, stored so the first AI answer stays visible. */
export function parseSummaryText(report, language) {
  const say = (key, args) => t(language, `aiContext.imaging.${key}`, args);
  const mm = (v) => t(language, 'aiContext.mm', { v });
  const lines = [say('parsed', { parts: [report.modality, report.region, report.date].filter(Boolean).join(', ') })];
  if (report.impression) lines.push(t(language, 'aiContext.ask.impression', { text: report.impression }));
  if (report.response) lines.push(say('change', { response: report.response === 'NA' ? say('noComparison') : responseLabel(report.response, language) }));
  if (report.lesions?.length) {
    lines.push(say('lesions'));
    for (const l of report.lesions) lines.push(`• ${l.name}${l.location ? ` (${l.location})` : ''}: ${l.sizeMm != null ? mm(l.sizeMm) : t(language, 'aiContext.ask.noSize')}${l.prevSizeMm != null ? say('was', { size: mm(l.prevSizeMm) }) : ''}${l.note ? `, ${l.note}` : ''}`);
  }
  if (report.newLesions) lines.push(say('newLesions'));
  if (report.warnings?.length) lines.push(say('unclear', { text: report.warnings.join('; ') }));
  return lines.join('\n');
}

export async function storeParseComment(userId, studyId, report, model, usage, language) {
  const r = await pool.query(
    'insert into ai_comments (user_id, subject_type, subject_id, model, text, usage) values ($1,$2,$3,$4,$5,$6) returning id',
    [userId, 'imaging_study', studyId, model || null, parseSummaryText(report, language), JSON.stringify(usage || {})]
  );
  return r.rows[0].id;
}

/** Plain-words explanation of one rendered slice (not stored). */
export async function explainSlice(userId, studyId, png, { index, total, window, tz } = {}) {
  const language = await userLanguage(userId);
  const ctx = await subjectContext(userId, 'imaging_study', studyId, language);
  if (!ctx) return null;
  const say = (key, args) => t(language, `aiContext.imaging.${key}`, args);
  const profile = await buildPatientProfile(userId, { tz, language });
  const user = `${t(language, 'aiContext.ask.patientData')}\n${profile}\n\n${say('section')}\n${ctx.text}\n\n${say('slice', { n: index + 1, total, window })}`;
  const out = await llmChat({ system: patientPrompt(language, 'explainSlice'), user, images: [{ mimeType: 'image/png', data: png }], maxTokens: 1600, tier: 'fast', language });
  return { text: out.text.trim(), model: out.model };
}
