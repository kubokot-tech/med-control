/**
 * Labs export: Excel (summary pivot + every result + catalog), PDF in the doctor-report style, CSV for
 * spreadsheets and AI, JSONL for scripts. All use the same pivot as the screen (buildSummary), so the
 * month value («худшее» / «последнее»), catalog names and preferred references match what the user sees.
 */
import { MARK_SIZE, pdfBrandLine, pdfMark } from '../lib/pdfBrand.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { pool } from '../lib/db.js';
import { buildLabsWhere, readLabsQuery, flag, refText } from '../lib/labsQuery.js';
import { comparatorOf } from '../../../shared/labBounds.js';
import { buildSummary } from '../lib/labsSummary.js';
import { catalog, markerName } from '../lib/canonical.js';
import { displayUnit } from '../../../shared/units.js';
import { excelDay, todayKey, DEFAULT_TZ } from '../lib/dates.js';
import { userLabUnits } from '../lib/labDisplay.js';
import { userFormat } from '../lib/userLocale.js';
import { raw, t } from '../lib/i18n.js';

const FONT_DIR = fileURLToPath(new URL('../../fonts/', import.meta.url));
const say = (language, key, args) => t(language, `labsExport.${key}`, args);
const fmtMonth = (ym, language) => { const [y, m] = ym.split('-'); return `${raw(language, `labsExport.month.${parseInt(m, 10)}`)} ${y}`; };
/** Numbers in the user's format (docs/I18N.md), up to 3 decimals; '' for null. */
const userNumber = async (userId) => { const f = await userFormat(userId); return (v) => (v == null ? '' : f.number(v, { maximumFractionDigits: 3 })); };
const dayOf = (ts, tz) => new Intl.DateTimeFormat('sv-SE', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ts));
const flagWord = (f, language) => (f ? say(language, `flag.${f}`) : '');
const pickWord = (pick, language) => (['worst', 'latest', 'max'].includes(pick) ? say(language, `pick.${pick}`) : pick);
const catKey = (c) => (c === 'urine' ? 'urine' : c === 'blood' ? 'blood' : 'all');
const catWord = (c, language) => say(language, `category.${catKey(c)}`);
const slug = (c, language) => say(language, `slug.${catKey(c)}`);

function describe(q, months, language) {
  const parts = [catWord(q.cat, language)];
  if (months.length) parts.push(say(language, 'monthRange', { from: fmtMonth(months[0], language), to: fmtMonth(months[months.length - 1], language) }));
  if (q.lab) parts.push(say(language, 'labFilter', { lab: q.lab }));
  parts.push(pickWord(q.pick, language));
  return parts.join(' · ');
}
function fileStem(q, months, language) {
  return say(language, 'fileStem', { cat: slug(q.cat, language), from: months[0] || say(language, 'fileEmpty'), to: months.length > 1 ? `-${months[months.length - 1]}` : '' });
}
/** The spreadsheet pattern of the user's date format. */
const excelDate = (f) => ({ mdy: 'mm/dd/yyyy', ymd: 'yyyy-mm-dd', dmy: 'dd.mm.yyyy' }[f.prefs.dateFormat] || (f.locale.startsWith('en-US') ? 'mm/dd/yyyy' : 'dd.mm.yyyy'));
async function allResults(q, tz) {
  const { where, params } = buildLabsWhere(q);
  const r = await pool.query(
    `select r.collected_at, t.code, t.canonical_key as key, t.category, r.value_numeric, r.value_text, r.unit_canonical, r.unit_original, r.ref_low, r.ref_high, r.lab_name,
            (select d.id from ingest_documents d where d.event_id = r.source_event_id limit 1) as document_id
       from lab_results_eff r join lab_tests t on t.id = r.test_id where ${where} order by r.collected_at, t.category, t.code`, params);
  const u = await userLabUnits(q.userId);
  const language = u.language;
  const show = (x, v) => (v == null ? null : x.key ? u.toDisplay(x.key, Number(v), x.unit_canonical).value : Number(v));
  return r.rows.map((x) => ({
    date: dayOf(x.collected_at, tz), name: (x.key && markerName(x.key, u.language)) || x.code, code: x.code, key: x.key, category: catWord(x.category, language),
    value: show(x, x.value_numeric), text: x.value_text, unit: (x.key ? u.unit(x.key, x.unit_canonical) : displayUnit(x.unit_canonical, u.language)) || '', unitOriginal: x.unit_original || '',
    refLow: show(x, x.ref_low), refHigh: show(x, x.ref_high),
    flagCode: flag(x.value_numeric, x.ref_low, x.ref_high, x.value_text), flag: flagWord(flag(x.value_numeric, x.ref_low, x.ref_high, x.value_text), language), lab: x.lab_name || '', documentId: x.document_id || '',
  }));
}

/** Preserve bounds and show cell-specific units/ranges when they differ from the row header. */
function pivotValue(cell, row, fmt, numericCell = false) {
  if (!cell) return null;
  const cmp = comparatorOf(cell.valueText);
  const differentUnit = cell.unit !== row.unit;
  const differentRange = cell.refLow !== row.refLow || cell.refHigh !== row.refHigh;
  if (numericCell && cell.valueNum != null && !cmp && !differentUnit && !differentRange) return cell.valueNum;
  const value = cell.valueNum != null ? cmp + fmt(cell.valueNum) : (cell.valueText || '—');
  const unit = differentUnit ? ' ' + (cell.unit || '—') : '';
  const range = differentRange ? ' (' + (refText(cell.refLow, cell.refHigh, fmt) || '—') + ')' : '';
  return value + unit + range;
}

export default async function labsExportRoutes(app) {
  // ---- Excel: «Сводная» + «Все результаты» + «Справочник» ----
  app.get('/labs/export/summary.xlsx', { preHandler: app.authenticate }, async (req, reply) => {
    const q = readLabsQuery(req); const tz = req.user.tz || DEFAULT_TZ;
    const fmtNum = await userNumber(q.userId);
    const format = await userFormat(q.userId);
    const { language } = format;
    const word = (key, args) => say(language, key, args);
    const month = (ym) => fmtMonth(ym, language);
    const { months, rows } = await buildSummary(q);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'MedControl'; wb.created = new Date();
    const FILL = { high: 'FFFBEEDB', low: 'FFFBEEDB', ok: 'FFE6F0E9' };
    const FONT = { high: 'FFA8641E', low: 'FFA8641E', ok: 'FF2F6B52' };
    const head = (ws, rowIdx) => { const r = ws.getRow(rowIdx); r.font = { bold: true, color: { argb: 'FF6F6659' }, size: 9 }; r.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1EBDF' } }; r.alignment = { vertical: 'middle' }; r.height = 20; };

    const ws = wb.addWorksheet(word('sheet.summary'), { views: [{ state: 'frozen', xSplit: 3, ySplit: 3 }] });
    ws.getCell('A1').value = word('xlsxTitle', { what: describe(q, months, language), date: todayKey(tz) });
    ws.getCell('A1').font = { bold: true, size: 12, color: { argb: 'FF2F6B52' } };
    ws.getCell('A2').value = word('xlsxNote');
    ws.getCell('A2').font = { italic: true, size: 9, color: { argb: 'FF8A8072' } };
    ws.addRow([word('col.marker'), word('col.unit'), word('col.range'), ...months.map(month)]); head(ws, 3);
    for (const row of rows) {
      const ref = refText(row.refLow, row.refHigh, fmtNum);
      const line = [row.short || row.name || row.test, row.unit || '', ref, ...months.map((m) => pivotValue(row.cells[m], row, fmtNum, true))];
      const rr = ws.addRow(line);
      rr.getCell(1).font = { bold: row.isCanonical };
      months.forEach((m, i) => {
        const c = row.cells[m]; if (!c) return;
        const f = flag(c.valueNum, c.refLow, c.refHigh, c.valueText);
        const cell = rr.getCell(4 + i);
        cell.numFmt = '0.###';
        if (FILL[f]) { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL[f] } }; cell.font = { color: { argb: FONT[f] }, bold: f !== 'ok' }; }
        if (c.n > 1) cell.note = word('cellNote', { n: c.n, pick: pickWord(q.pick, language), date: c.collectedAt ? dayOf(c.collectedAt, tz) : '' });
      });
    }
    ws.columns = [{ width: 30 }, { width: 11 }, { width: 14 }, ...months.map(() => ({ width: 11 }))];
    if (rows.length) ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3 + rows.length, column: 3 + months.length } };

    const ws2 = wb.addWorksheet(word('sheet.results'), { views: [{ state: 'frozen', ySplit: 1 }] });
    ws2.addRow(['date', 'marker', 'asPrinted', 'category', 'value', 'text', 'unit', 'rangeFrom', 'rangeTo', 'deviation', 'lab', 'unitPrinted', 'document'].map((k) => word(`col.${k}`))); head(ws2, 1);
    const all = await allResults(q, tz);
    for (const x of all) {
      const rr = ws2.addRow([excelDay(x.date), x.name, x.code, x.category, x.value, x.text || '', x.unit, x.refLow, x.refHigh, x.flag, x.lab, x.unitOriginal, x.documentId]);
      rr.getCell(1).numFmt = excelDate(format);
      const f = x.flagCode;
      if (FILL[f]) rr.getCell(5).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL[f] } };
    }
    ws2.columns = [{ width: 12 }, { width: 30 }, { width: 30 }, { width: 10 }, { width: 11 }, { width: 14 }, { width: 11 }, { width: 10 }, { width: 10 }, { width: 13 }, { width: 24 }, { width: 14 }, { width: 38 }];
    if (all.length) ws2.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1 + all.length, column: 13 } };

    const ws3 = wb.addWorksheet(word('sheet.catalog'));
    ws3.addRow(['key', 'marker', 'short', 'category', 'unitCatalog', 'isKey'].map((k) => word(`col.${k}`))); head(ws3, 1);
    for (const c of catalog(language)) ws3.addRow([c.key, c.name, c.short || '', catWord(c.category, language), displayUnit(c.unit, language) || '', c.isKey ? word('yes') : '']);
    ws3.columns = [{ width: 10 }, { width: 44 }, { width: 18 }, { width: 11 }, { width: 12 }, { width: 10 }];

    const buf = await wb.xlsx.writeBuffer();
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileStem(q, months, language) + '.xlsx')}`);
    return reply.send(Buffer.from(buf));
  });

  // ---- PDF in the doctor-report style: one table per category, months in chunks, rows wrap ----
  app.get('/labs/export/summary.pdf', { preHandler: app.authenticate }, async (req, reply) => {
    const q = readLabsQuery(req); const tz = req.user.tz || DEFAULT_TZ;
    const fmtNum = await userNumber(q.userId);
    const { language } = await userFormat(q.userId);
    const word = (key, args) => say(language, key, args);
    const month = (ym) => fmtMonth(ym, language);
    const { months, rows } = await buildSummary(q);
    const C = { fg: '#1e2a36', fg2: '#56657a', fg3: '#7d8a99', accent: '#1f5fa6', warn: '#a8641e', border: '#dbe3ec', surface2: '#e7edf4' };
    const landscape = months.length > 6;
    const doc = new PDFDocument({ size: 'A4', layout: landscape ? 'landscape' : 'portrait', margin: 40, bufferPages: true, info: { Title: word('pdfInfo') } });
    const chunks = []; doc.on('data', (c) => chunks.push(c));
    doc.registerFont('Inter', path.join(FONT_DIR, 'Inter-Regular.ttf')); doc.registerFont('Inter-Bold', path.join(FONT_DIR, 'Inter-Bold.ttf')); doc.registerFont('Inter-SemiBold', path.join(FONT_DIR, 'Inter-SemiBold.ttf'));
    const W = doc.page.width - 80; const L = 40;
    const ensure = (h) => { if (doc.y + h > doc.page.height - 56) doc.addPage(); };
    const section = (title) => { ensure(40); doc.moveDown(0.6); doc.font('Inter-Bold').fontSize(12).fillColor(C.accent).text(title, L, doc.y, { width: W }); doc.moveTo(L, doc.y + 2).lineTo(L + W, doc.y + 2).strokeColor(C.border).lineWidth(1).stroke(); doc.moveDown(0.4); };
    const table = (cols, data, widths, aligns = []) => {
      const drawHead = () => { const y = doc.y; doc.font('Inter-SemiBold').fontSize(7.5).fillColor(C.fg3); let x = L; cols.forEach((c, i) => { doc.text(c.toUpperCase(), x + 3, y, { width: widths[i] - 6, lineBreak: false, align: aligns[i] || 'left' }); x += widths[i]; }); doc.y = y + 14; };
      ensure(40); drawHead();
      data.forEach((r, ri) => {
        const cells = r.map((c) => (typeof c === 'object' && c !== null ? c : { text: String(c ?? '') }));
        const rowH = Math.max(16, ...cells.map((c, i) => { doc.font(c.bold ? 'Inter-SemiBold' : 'Inter').fontSize(8.5); return doc.heightOfString(c.text, { width: widths[i] - 6 }) + 5; }));
        if (doc.y + rowH > doc.page.height - 56) { doc.addPage(); drawHead(); }
        const y = doc.y;
        if (ri % 2 === 0) doc.rect(L, y - 2, W, rowH).fill(C.surface2);
        let x = L;
        cells.forEach((c, i) => { doc.font(c.bold ? 'Inter-SemiBold' : 'Inter').fontSize(8.5).fillColor(c.color || C.fg).text(c.text, x + 3, y, { width: widths[i] - 6, align: aligns[i] || 'left' }); x += widths[i]; });
        doc.y = y + rowH;
      });
      doc.x = L; doc.moveDown(0.3);
    };
    // header band
    doc.rect(0, 0, doc.page.width, 64).fill(C.accent);
    pdfMark(doc, L, 6);
    doc.font('Inter-Bold').fontSize(18).fillColor('#ffffff').text(word('pdfTitle'), L, 16);
    doc.font('Inter').fontSize(9.5).fillColor('#ffffff').text(word('pdfSubtitle', { what: describe(q, months, language), date: todayKey(tz) }), L, 40, { width: W - MARK_SIZE - 8 });
    doc.y = 80; doc.x = L; doc.fillColor(C.fg);
    if (!rows.length) { doc.font('Inter').fontSize(10).text(word('pdfEmpty'), L, doc.y); }
    const perTable = landscape ? 10 : 6;
    const groups = [['blood', word('pdfBlood')], ['urine', word('pdfUrine')]].filter(([c]) => rows.some((r) => r.category === c));
    for (const [cat, title] of groups) {
      const rs = rows.filter((r) => r.category === cat);
      for (let i = 0; i < months.length; i += perTable) {
        const ms = months.slice(i, i + perTable);
        section(`${title}${months.length > perTable ? ` · ${word('monthRange', { from: month(ms[0]), to: month(ms[ms.length - 1]) })}` : ''}`);
        const nameW = landscape ? 150 : 118, unitW = 58, refW = 60;
        const mw = (W - nameW - unitW - refW) / ms.length;
        table([word('col.marker'), word('col.unit'), word('col.rangeShort'), ...ms.map(month)], rs.map((r) => [
          { text: r.short || r.name || r.test, bold: r.isCanonical }, r.unit || '', refText(r.refLow, r.refHigh, fmtNum) || '—',
          ...ms.map((m) => { const c = r.cells[m]; if (!c) return { text: '—', color: C.fg3 }; const f = flag(c.valueNum, c.refLow, c.refHigh, c.valueText); return { text: pivotValue(c, r, fmtNum) + (c.n > 1 ? `·${c.n}` : ''), bold: f === 'high' || f === 'low', color: f === 'high' || f === 'low' ? C.warn : f === 'ok' ? C.accent : C.fg }; }),
        ]), [nameW, unitW, refW, ...ms.map(() => mw)], ['left', 'left', 'left', ...ms.map(() => 'center')]);
      }
    }
    doc.moveDown(0.4); ensure(30);
    doc.font('Inter').fontSize(8).fillColor(C.fg3).text(word('pdfLegend', { pick: pickWord(q.pick, language) }), L, doc.y, { width: W });
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i); doc.page.margins.bottom = 0;
      pdfBrandLine(doc, (site) => word('pdfBrandLine', { site }), L, doc.page.height - 36, W, C.accent);
      doc.font('Inter').fontSize(7.5).fillColor(C.fg3).text(word('pdfFooter', { page: i + 1, pages: range.count }), L, doc.page.height - 25, { width: W, align: 'center', lineBreak: false });
    }
    doc.end();
    const buf = await new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileStem(q, months, language) + '.pdf')}`);
    return reply.send(buf);
  });

  // ---- CSV: every result, long format, UTF-8 with BOM; «;» and a decimal comma for Russian Excel, «,» and a dot in English ----
  app.get('/labs/export/results.csv', { preHandler: app.authenticate }, async (req, reply) => {
    const q = readLabsQuery(req); const tz = req.user.tz || DEFAULT_TZ;
    const { language } = await userFormat(q.userId);
    const all = await allResults(q, tz);
    const [sep, decimal] = language === 'ru' ? [';', ','] : [',', '.'];
    const cell = (v) => { const s = v == null ? '' : String(v); return s.includes(sep) || /["\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const num = (v) => (v != null ? String(v).replace('.', decimal) : '');
    const head = ['date', 'marker', 'asPrinted', 'key', 'category', 'value', 'text', 'unit', 'rangeFrom', 'rangeTo', 'deviation', 'lab', 'document'].map((k) => say(language, `col.${k}`));
    const lines = [head.join(sep), ...all.map((x) => [x.date, x.name, x.code, x.key || '', x.category, num(x.value), x.text || '', x.unit, num(x.refLow), num(x.refHigh), x.flag, x.lab, x.documentId].map(cell).join(sep))];
    const { months } = await buildSummary(q);
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileStem(q, months, language) + '.csv')}`);
    return reply.send('﻿' + lines.join('\r\n'));
  });

  // ---- JSONL for scripts (kept for compatibility) ----
  app.get('/labs/export/observations.jsonl', { preHandler: app.authenticate }, async (req, reply) => {
    const q = readLabsQuery(req); const tz = req.user.tz || DEFAULT_TZ;
    const { language } = await userFormat(q.userId);
    const all = await allResults(q, tz);
    reply.header('Content-Type', 'application/x-ndjson; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="${say(language, 'jsonlName', { cat: slug(q.cat, language) })}"`);
    return reply.send(all.map(({ flagCode: _f, ...x }) => JSON.stringify(x)).join('\n'));
  });
}
