/**
 * Telegram inbox: long-polls getUpdates and files every PDF sent from the
 * configured chat into MedControl through the same pipeline as the web upload.
 * Only TELEGRAM_CHAT_ID is served; anything else is ignored and logged.
 */
import { createHash } from 'node:crypto';
import { telegramConfig, telegramReady, sendTelegram, noteChats, editTelegram, answerCallback, keyboard } from './telegram.js';
import { activeDailyItem, recordDose, dayStatus, doseOn } from './medsRecord.js';
import { todayKey, addDays, noonIn } from './dates.js';
import { userFormat } from './userLocale.js';
import { parseSymptomsText } from './symptomsText.js';
import { saveSymptoms, summarize } from './symptoms.js';
import { updateAppointment } from './appointments.js';
import { getSetting, setSetting } from './settings.js';
import { commitLabsPdf, commitParsed, loadPending, dropPending, resolvePending } from './labsCommit.js';
import { esc, commitSummary } from './telegramText.js';
import { telegramFetch } from './egress.js';
import { isDoseDay, describeSchedule } from './schedule.js';
import { doseUnit } from './eventText.js';
import { t } from './i18n.js';
import { bodyUnits } from '../../../shared/units.js';

const MAX_FILE = 20 * 1024 * 1024; // Bot API download limit

// The words work in either language, whatever the setting. A bare «yes» or «no» counts only alone: «no nausea» is a diary line.
const TAKEN_RX = /^(принял|принято|выпил|выпила|приняла|\+|да|ок|ok|done|taken|take|took|mark taken)(?:[\s.!]|$)\s*(.*)$/i;
const SKIPPED_RX = /^(пропустил|пропустила|пропуск|-|нет|skip|skipped|missed)(?:[\s.!]|$)\s*(.*)$/i;
const YES_RX = /^yes[\s.!]*$/i;
const NO_RX = /^no[\s.!]*$/i;
const STATUS_RX = /^(статус|\?|status)(?:[\s.!?]|$)/i;
const STATES = { TAKEN: 'taken', SKIPPED: 'skipped', PAUSED: 'paused', MISSED: 'missed', PLANNED: 'planned' };
/** A day of a medication in words: «принят», «принят 1 из 2», «пропущен». */
const dayText = (d, language) => {
  const say = (key, args) => t(language, `bot.state.${key}`, args);
  if (d.status === 'PARTIAL') return say('partial', { taken: d.taken, times: d.times });
  if (d.times > 1 && d.status === 'TAKEN') return say('partial', { taken: d.times, times: d.times });
  return STATES[d.status] ? say(STATES[d.status]) : d.status;
};
/** « 24 мг» after a medication name, '' without a dose. */
const doseText = (value, unit, language) => (value ? ` ${value} ${doseUnit(unit, language)}` : '');

/** Bot core with injectable transport: { handle, handleCallback, start, stop }. `tg` = { send, edit, answer }. */
export function createTelegramBot({ userId, log = console, fetchImpl = telegramFetch, tg: transport = { send: sendTelegram, edit: editTelegram, answer: answerCallback } } = {}) {
  const { token, chatId, appUrl } = telegramConfig();
  const botId = /^([0-9]+):/.exec(token)?.[1] ?? createHash('sha256').update(token).digest('hex');
  const offsetKey = `tg_offset_${botId}`;
  let offset = Number(getSetting(offsetKey) || 0);
  let stopped = false;
  const lifetime = new AbortController();
  const jobs = new Set();
  const current = () => {
    const config = telegramConfig();
    return !stopped && token === config.token && chatId === config.chatId;
  };
  const guarded = (method) => (...args) => current() ? method(...args) : Promise.resolve();
  const tg = { send: guarded(transport.send), edit: guarded(transport.edit), answer: guarded(transport.answer) };


  async function api(method, body) {
    const r = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}), signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(60_000)]),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.description || `telegram ${method} failed (${r.status})`);
    return j.result;
  }

  async function download(fileId) {
    const f = await api('getFile', { file_id: fileId });
    if (f.file_size && f.file_size > MAX_FILE) throw Object.assign(new Error('too big'), { code: 'too_big' });
    const r = await fetchImpl(`https://api.telegram.org/file/bot${token}/${f.file_path}`, { signal: lifetime.signal });
    if (!r.ok) throw new Error(`download failed (${r.status})`);
    return Buffer.from(await r.arrayBuffer());
  }

  // «today» and times in the user's own time zone (Settings → «Язык и регион»), the words in the user's language
  async function markDose(status, day, viaText, medicationId, nameLike) {
    const f = await userFormat(userId);
    const language = f.language;
    const say = (key, args) => t(language, `bot.dose.${key}`, args);
    const item = await activeDailyItem(userId, { medicationId, nameLike });
    if (!item) return nameLike ? say('notFound', { name: nameLike }) : say('noActive');
    const tz = f.timeZone;
    const today = todayKey(tz);
    const takenAt = day === today ? new Date().toISOString() : noonIn(day, tz);
    const d = await doseOn(item.regimenItemId, day); // the dose that was in effect that day, not today's
    if (!current()) return;
    const r = await recordDose(userId, { medicationId: item.medicationId, regimenItemId: item.regimenItemId, status, takenAt, doseValue: status === 'TAKEN' ? d.doseValue : null, doseUnit: status === 'TAKEN' ? d.doseUnit : null, notes: viaText ? 'telegram' : 'telegram, кнопка', tz, source: 'telegram' });
    const when = day === today ? say('today') : day;
    if (r.already) return say('already', { name: item.name, when, state: dayText(r.already, language), url: `${appUrl}/meds` });
    const of = r.times > 1 ? say('of', { n: r.doseNo, times: r.times }) : '';
    return status === 'TAKEN'
      ? say('taken', { name: item.name, dose: doseText(d.doseValue, d.doseUnit, language), when, of, at: day === today ? say('at', { time: f.time(new Date()) }) : '' })
      : say('skipped', { name: item.name, when, of });
  }
  async function statusText() {
    const { activeItems } = await import('./medsRecord.js');
    const f = await userFormat(userId);
    const language = f.language;
    const say = (key, args) => t(language, `bot.${key}`, args);
    const items = await activeItems(userId);
    if (!items.length) return say('dose.noActive');
    const today = todayKey(f.timeZone);
    const lines = [];
    for (const item of items) {
      const st = await dayStatus(userId, item.medicationId, today);
      const none = !st && !isDoseDay(item, today) ? say('status.noDose', { schedule: describeSchedule(item, language) }) : say('status.notMarked');
      lines.push(`${item.role === 'systemic' ? '💊' : '▫️'} ${item.name}: ${st ? dayText(st, language) : none}`);
    }
    if (items.length > 1) lines.push(say('status.hint'));
    return lines.join('\n');
  }
  async function handleCallback(cq) {
    const chat = String(cq.message?.chat?.id);
    const f = await userFormat(userId);
    const say = (key, args) => t(f.language, `bot.callback.${key}`, args);
    if (!current()) return;
    if (chat !== String(chatId)) { await tg.answer(cq.id, say('notYourChat')); return; }
    const lm0 = /^labs:(save|drop):([a-f0-9]{16,64})$/.exec(cq.data || '');
    const lm = lm0 ? [lm0[0], lm0[1], await resolvePending(lm0[2])] : null;
    if (lm0 && !lm[2]) { await tg.answer(cq.id, say('draftDone')); return; }
    if (lm) {
      try {
        const pending = await loadPending(lm[2]);
        if (!current()) return;
        if (!pending) { await tg.answer(cq.id, say('draftDone')); return; }
        if (lm[1] === 'drop') {
          await dropPending(lm[2]);
          await tg.answer(cq.id, say('canceled'));
          await tg.edit(chat, cq.message.message_id, `${cq.message.text}\n\n${say('canceledNote')}`);
          return;
        }
        const d = pending.draft;
        const r = await commitParsed({ userId, buf: pending.buf, filename: d.filename, parsed: { sha256: d.sha256, source: 'ai_pdf_v1', lab_name: d.lab_name, doc_date: d.doc_date, observations: d.observations } });
        await dropPending(lm[2]);
        await tg.answer(cq.id, say('saved'));
        await tg.edit(chat, cq.message.message_id, `${cq.message.text}\n\n${commitSummary(r, appUrl, f)}`);
        log.info({ sha256: r.sha256, inserted: r.inserted }, 'telegram bot: ai draft committed');
      } catch (e) {
        log.warn({ err: e.message }, 'telegram bot: ai draft failed');
        await tg.answer(cq.id, say('saveFailed'));
      }
      return;
    }
    const am = /^appt:done:([0-9a-f-]{36})$/.exec(cq.data || '');
    if (am) {
      try {
        if (!current()) return;
        const a = await updateAppointment(userId, am[1], { status: 'done' });
        await tg.answer(cq.id, say(a ? 'marked' : 'notFound'));
        if (a) await tg.edit(chat, cq.message.message_id, `${cq.message.text}\n\n${say('apptDone')}`);
      } catch (e) { log.warn({ err: e.message }, 'telegram bot: appt done failed'); await tg.answer(cq.id, say('failed')).catch(() => {}); }
      return;
    }
    const m = /^dose:(TAKEN|SKIPPED):(\d{4}-\d{2}-\d{2})(?::([0-9a-f-]{36}))?$/.exec(cq.data || '');
    if (!m) { await tg.answer(cq.id); return; }
    try {
      const text = await markDose(m[1], m[2], false, m[3] || undefined);
      await tg.answer(cq.id, text.slice(0, 190));
      await tg.edit(chat, cq.message.message_id, `${cq.message.text}\n\n${text}`);
      log.info({ status: m[1], day: m[2] }, 'telegram bot: dose via button');
    } catch (e) {
      log.warn({ err: e.message }, 'telegram bot: dose button failed');
      await tg.answer(cq.id, say('doseFailed'));
    }
  }
  async function handle(msg) {
    const chat = String(msg.chat?.id);
    if (!current()) return;
    if (chat !== String(chatId)) {
      log.warn({ chat, from: msg.from?.username }, 'telegram bot: message from unknown chat ignored');
      return;
    }
    const f = await userFormat(userId);
    const language = f.language;
    const say = (key, args) => t(language, `bot.${key}`, args);
    const doc = msg.document;
    const isPdf = doc && (doc.mime_type === 'application/pdf' || /\.pdf$/i.test(doc.file_name || ''));
    if (isPdf) {
      try {
        const buf = await download(doc.file_id);
        if (!current()) return;
        const r = await commitLabsPdf({ userId, buf, filename: doc.file_name || 'telegram.pdf' });
        if (r.needsReview) {
          const d = r.draft;
          const flagged = d.observations.filter((o) => o.result_num != null && ((o.ref_high != null && o.result_num > o.ref_high) || (o.ref_low != null && o.result_num < o.ref_low)));
          const lines = [say('pdf.aiRead', { model: esc(d.model || '') }),
            say('pdf.aiSummary', { lab: esc(d.lab_name || say('pdf.labUnknown')), date: esc(d.doc_date || say('pdf.dateUnknown')), n: d.observations.length, flagged: flagged.length })];
          for (const o of flagged.slice(0, 6)) lines.push(`${o.ref_high != null && o.result_num > o.ref_high ? '↑' : '↓'} ${esc(o.test_name_raw)} ${esc(o.result_text ?? o.result_num)} ${esc(o.unit_raw || '')}`);
          if (d.warnings?.length) lines.push(say('pdf.doubts', { text: esc(d.warnings.join('; ')).slice(0, 300) }));
          lines.push(say('pdf.review', { url: `${appUrl}/labs/upload?pending=${r.sha256}` }));
          await tg.send(lines.join('\n'), undefined, keyboard([[{ text: say('pdf.saveAsIs'), data: `labs:save:${r.sha256.slice(0, 16)}` }, { text: say('pdf.cancel'), data: `labs:drop:${r.sha256.slice(0, 16)}` }]]));
          log.info({ sha256: r.sha256, rows: d.observations.length }, 'telegram bot: ai draft sent for review');
          return;
        }
        log.info({ sha256: r.sha256, inserted: r.inserted, already: r.already }, 'telegram bot: pdf filed');
        await tg.send(commitSummary(r, appUrl, f));
      } catch (e) {
        log.warn({ err: e.message, code: e.code }, 'telegram bot: pdf failed');
        const why = say(`pdf.why.${e.code === 'ingestion_failed' ? 'format' : e.code === 'ai_empty' ? 'empty' : e.code === 'too_big' ? 'tooBig' : 'server'}`);
        await tg.send(say('pdf.failed', { file: esc(doc.file_name || say('pdf.file')), why, url: `${appUrl}/labs/upload` }));
      }
      return;
    }
    if (msg.photo || (doc && !isPdf)) {
      await tg.send(say('pdf.only'));
      return;
    }
    if (msg.text) {
      const text = msg.text.trim();
      const tz = f.timeZone;
      const today = todayKey(tz);
      const tk = TAKEN_RX.exec(text); if (tk) { await tg.send(await markDose('TAKEN', today, true, undefined, tk[2]?.trim() || undefined)); return; }
      const sk = SKIPPED_RX.exec(text); if (sk) { await tg.send(await markDose('SKIPPED', today, true, undefined, sk[2]?.trim() || undefined)); return; }
      if (YES_RX.test(text)) { await tg.send(await markDose('TAKEN', today, true)); return; }
      if (NO_RX.test(text)) { await tg.send(await markDose('SKIPPED', today, true)); return; }
      if (STATUS_RX.test(text)) { await tg.send(await statusText()); return; }
      const diary = parseSymptomsText(text, { temperature: f.temperature, weight: f.weight });
      if (diary) {
        const date = diary.yesterday ? addDays(today, -1) : today;
        try {
          if (!current()) return;
          const r = await saveSymptoms(userId, date, diary.entry, tz, { appendNotes: true });
          const body = bodyUnits({ temperature: f.temperature, weight: f.weight, language });
          const lines = [say('diary.saved', { when: say(diary.yesterday ? 'diary.yesterday' : 'dose.today'), summary: summarize(r.entry, language, { body }) })];
          if (r.alertsRaised) lines.push(say('diary.alert', { url: `${appUrl}/alerts` }));
          if (diary.unknown.length) lines.push(say('diary.unknown', { text: esc(diary.unknown.join('; ')) }));
          await tg.send(lines.join('\n'));
          log.info({ date, fields: diary.recognized }, 'telegram bot: diary line saved');
        } catch (e) {
          log.warn({ err: e.message }, 'telegram bot: diary line failed');
          await tg.send(say('diary.failed', { error: esc(e.message), url: `${appUrl}/symptoms` }));
        }
        return;
      }
      await tg.send(say('help'));
    }
  }

  async function loop() {
    log.info('telegram bot: polling started');
    let backoff = 10_000;
    const legacyOffset = getSetting('tg_offset');
    if (legacyOffset && !getSetting(offsetKey)) {
      offset = Number(legacyOffset);
      await setSetting(offsetKey, String(offset));
    }
    if (legacyOffset) await setSetting('tg_offset', '');
    while (current()) {
      try {
        const updates = await api('getUpdates', { offset, timeout: 25, allowed_updates: ['message', 'callback_query'] });
        for (const u of updates) {
          if (!current()) return;
          offset = u.update_id + 1;
          await setSetting(offsetKey, String(offset));
          if (!current()) return;
          if (u.message?.chat) noteChats([u.message.chat], token);
          // documents (PDF parsing, AI) run beside the loop so dose buttons stay responsive
          const job = u.message ? handle(u.message) : u.callback_query ? handleCallback(u.callback_query) : null;
          if (!job) continue;
          jobs.add(job);
          const tracked = job.finally(() => jobs.delete(job));
          if (u.message?.document) tracked.catch((e) => log.warn({ err: e.message }, 'telegram bot: document failed'));
          else await tracked;
        }
        backoff = 10_000;
      } catch (e) {
        if (stopped) break;
        // back off up to 5 minutes when Telegram is unreachable; log only when the delay grows
        if (backoff <= 10_000 || backoff >= 300_000) log.warn({ err: e.message, retryInSec: backoff / 1000 }, 'telegram bot: poll error');
        await new Promise((r) => setTimeout(r, backoff));
        backoff = Math.min(300_000, backoff * 2);
      }
    }
  }
  function stop() {
    stopped = true;
    lifetime.abort();
    return Promise.allSettled([...jobs]);
  }
  return { handle, handleCallback, current, start: loop, stop };
}

let active = null; let lastOpts = null;
function stopActive() {
  const draining = active?.stop();
  active = null;
  return draining;
}
export function startTelegramBot(opts = {}) {
  const log = opts.log || console;
  lastOpts = opts;
  if (active) return stopActive;
  if (!telegramReady()) { log.info('telegram bot: off (no token or chat id)'); return stopActive; }
  active = createTelegramBot(opts);
  active.start().catch((err) => log.error({ err }, 'telegram bot: polling stopped'));
  return stopActive;
}
/** Start the bot later, once the wizard or settings provided a token and chat id. */
export function ensureTelegramBot() {
  let draining;
  if (active && !active.current()) {
    draining = stopActive();
  }
  if (!active && lastOpts && telegramReady()) startTelegramBot(lastOpts);
  return draining;
}
