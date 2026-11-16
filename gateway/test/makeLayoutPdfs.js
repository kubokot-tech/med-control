/**
 * Synthetic lab-like PDFs (invented data) in a few layouts, to check that pdf.js (src/lib/pdfText.js) lays text out
 * like pypdf: rows of cells, wrapped text and a second page, cells drawn right to left, a shifted baseline.
 * Regenerate: node test/makeLayoutPdfs.js, then cd ingestion && python tools/golden.py for the .pypdf.txt files.
 */
import PDFDocument from 'pdfkit';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
const FONTS = fileURLToPath(new URL('../fonts', import.meta.url));
const OUT = process.argv[2] || fileURLToPath(new URL('../../ingestion/tests/fixtures/pdf', import.meta.url));
function make(name, draw) {
  return new Promise((res) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    doc.registerFont('R', `${FONTS}/Inter-Regular.ttf`);
    doc.registerFont('B', `${FONTS}/Inter-Bold.ttf`);
    doc.font('R').fontSize(10);
    const chunks = []; doc.on('data', (c) => chunks.push(c)); doc.on('end', () => { fs.writeFileSync(`${OUT}/${name}.pdf`, Buffer.concat(chunks)); res(); });
    draw(doc); doc.end();
  });
}
const helixRows = [['Гемоглобин', '132', 'г/л', '117 - 160'], ['Лейкоциты', '6,2', '*10^9/л', '4 - 9'], ['С-реактивный белок', '<0,6', 'мг/л', '0 - 5']];
// 1) table rows: cells at fixed x, same y
await make('rows', (d) => {
  d.font('B').fontSize(12).text('Петрова Анна Сергеевна', 40, 40); d.font('R').fontSize(10);
  d.text('Перейти в Личный кабинет', 40, 60); d.text('Заказ № 987654321', 40, 74); d.text('Зарегистрирован: 14.04.2026 07:40', 40, 88);
  d.font('B').text('Общий анализ крови', 40, 110); d.font('R');
  let y = 130; const x = [40, 260, 330, 420];
  ['Название/показатель', 'Результат', 'Ед. изм.', 'Референсные значения'].forEach((h, i) => d.text(h, x[i], y, { lineBreak: false }));
  for (const r of helixRows) { y += 16; r.forEach((c, i) => d.text(c, x[i], y, { lineBreak: false })); }
  d.text('* Время указано по Москве', 40, y + 30);
});
// 2) flowing text with wrapping and a second page
await make('flow', (d) => {
  d.text('Зарегистрирован: 03.02.2026 08:15');
  d.text('Очень длинное название показателя, которое не помещается в одну строку и переносится на следующую строку в ячейке таблицы бланка', { width: 200 });
  d.addPage(); d.text('Вторая страница: Тромбоциты 210 *10^9/л 150 - 400');
});
// 3) cells of one row drawn right-to-left (stream order differs from visual order)
await make('rtl', (d) => {
  const x = [40, 260, 330, 420]; const r = helixRows[0];
  for (let i = 3; i >= 0; i--) d.text(r[i], x[i], 100, { lineBreak: false });
  d.text('Лейкоциты', 40, 116, { lineBreak: false }); d.text('6,2', 260, 116, { lineBreak: false });
});
// 4) a slightly lower baseline inside a row (vertical centering of a smaller unit font)
await make('baseline', (d) => {
  d.text('Гемоглобин', 40, 100, { lineBreak: false }); d.text('132', 260, 100, { lineBreak: false });
  d.fontSize(8).text('г/л', 330, 101.5, { lineBreak: false }); d.fontSize(10).text('117 - 160', 420, 100, { lineBreak: false });
});
console.log('made', fs.readdirSync(OUT).filter((f) => f.endsWith('.pdf')).join(' '));
