import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { anonymizeLabText, labSampleFromPdf } from '../src/lib/labSample.js';
import { parseLabText, byId } from '../src/lib/labParsers/index.js';
import labSampleRoutes from '../src/routes/labSample.js';

const FIXTURES = fileURLToPath(new URL('../../ingestion/tests/fixtures/', import.meta.url));
const fixtures = readdirSync(FIXTURES).filter((f) => f.endsWith('.txt'));
const anon = (text) => anonymizeLabText(text, { randomDigit: () => '7' });

// Everything here is invented; each line is the kind of thing a report carries about a person.
const REPORT = [
  'ООО "Лаборатория Здоровье Плюс", г. Примерск, ул. Тестовая, д. 1, тел. +7 (000) 555-12-34',
  'Пациент: Кузнецова Елена Викторовна',
  'Пациент: КУЗНЕЦОВА Е.В.',
  'Дата рождения: 14.03.1961 Возраст: 65 лет Пол: женский',
  'Полис ОМС 6350 1234 5678 9012, СНИЛС 123-456-789 00, паспорт 3604 123456',
  'Лечащий врач: д-р Смирнов А.П., e-mail elena.k61@example.com',
  'Заказ № A7-2204518, штрихкод 4600000123456',
  'Дата взятия: 21.10.2026 08:45 Исследование 2026-10-22',
].join('\n');

test('a person does not survive: names, initials, addresses, contacts, numbers', () => {
  const out = anon(REPORT);
  for (const leaked of ['Кузнецов', 'КУЗНЕЦОВ', 'Елена', 'Викторовна', 'Е.В', 'Примерск', 'Тестовая', 'Здоровье', 'Плюс', 'Смирнов', 'А.П', 'elena', 'example',
    '555', '1234', '5678', '9012', '123-456', '3604', '2204518', '4600000123456', '14.03.1961', '1961', '21.10.2026', '08:45', '2026-10-22']) {
    assert.ok(!out.includes(leaked), `leaked: ${leaked}\n${out}`);
  }
  assert.equal(out.split('\n')[1], 'Пациент: Ххххх Ххххх Ххххх');
  assert.equal(out.split('\n')[7], 'Дата взятия: 01.02.2026 12:00 Исследование 2026-02-01');
});

test('letters, combining marks and digits from other scripts are anonymized', () => {
  const out = anon('Пациент: Թեստ անուն العربية 患者名 a\u0301bc ١٢٣ 𝟘');
  assert.doesNotMatch(out, /[Թեստանուالعربية患者名\u0301١٢٣𝟘]/u);
  assert.match(out, /777 7$/);
});

test('every digit is replaced, even inside a number with a unit', () => {
  const out = anonymizeLabText('Гемоглобин 123 г/л 120 - 160', { randomDigit: () => '0' });
  assert.equal(out, 'Гемоглобин 000 г/л 000 - 000');
});

test('test names, units and service words stay, with the power of ten in a unit', () => {
  const line = 'Лейкоциты (WBC) 5,1 *10^9/л 4,0 - 9,0\nТромбоциты 10*9/л\nСОЭ мм/час\nД-димер нг/мл\nОбщий белок г/л\nРезультат Референсное значение Ед.изм.';
  const out = anon(line);
  assert.equal(out, 'Лейкоциты (WBC) 7,7 *10^9/л 7,7 - 7,7\nТромбоциты 10*9/л\nСОЭ мм/час\nД-димер нг/мл\nОбщий белок г/л\nРезультат Референсное значение Ед.изм.');
});

test('a power of ten at the end of a line, its unit on the next one', () => {
  assert.equal(anon('Бактерии 12,60 *10^3\nкл/мл'), 'Бактерии 77,77 *10^3\nкл/мл');
});

test('a lone letter stays only inside a unit or a name', () => {
  assert.equal(anon('5 г/л'), '7 г/л');
  assert.equal(anon('Иванов И. И.'), 'Ххххх Ххххх. Ххххх.');
});

test('the lines of a report stay in place', () => {
  for (const f of fixtures) {
    const src = readFileSync(FIXTURES + f, 'utf8');
    assert.equal(anon(src).split('\n').length, src.split('\n').length, f);
  }
});

test('the invented people of our fixtures are masked too', () => {
  const all = fixtures.map((f) => anon(readFileSync(FIXTURES + f, 'utf8'))).join('\n');
  assert.doesNotMatch(all, /Иванов|Петров|Сидоров|Андреевн|Сергеевн|Петрович|Москв|Анна|Мария|Ольга/i);
});

test('a parser written from a sample works: the rows survive anonymization', () => {
  let checked = 0;
  for (const f of fixtures) {
    const src = readFileSync(FIXTURES + f, 'utf8');
    const parsed = parseLabText(src);
    if (!parsed) continue;
    const doc = byId(parsed.source).parseText(anon(src));
    assert.equal(doc.observations.length, parsed.observations.length, f);
    if (f === 'hadassah_blood.txt') assert.deepEqual(doc.observations.map((o) => o.test_name), parsed.observations.map((o) => o.test_name_raw));
    checked += 1;
  }
  assert.ok(checked >= 3);
});

test('a file that is not a PDF is refused', async () => {
  await assert.rejects(labSampleFromPdf(Buffer.from('plain text')), { code: 'not_pdf' });
});

async function samplesApp() {
  const app = Fastify();
  await app.register(multipart);
  app.decorate('authenticate', async () => {});
  await app.register(labSampleRoutes);
  return app;
}

// one page, no text: what a scan looks like to the text layer
const BLANK_PDF = Buffer.from(`%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >> endobj
trailer << /Root 1 0 R >>
%%EOF
`);

function multipartPdf(buf) {
  const b = 'sampleboundary';
  const head = `--${b}\r\nContent-Disposition: form-data; name="file"; filename="a.pdf"\r\nContent-Type: application/pdf\r\n\r\n`;
  return { payload: Buffer.concat([Buffer.from(head), buf, Buffer.from(`\r\n--${b}--\r\n`)]), headers: { 'content-type': `multipart/form-data; boundary=${b}` } };
}

test('POST /labs/sample: a PDF becomes text, a scan and a foreign file are refused', async () => {
  const app = await samplesApp();
  const ok = await app.inject({ method: 'POST', url: '/labs/sample', ...multipartPdf(readFileSync(`${FIXTURES}pdf/rows.pdf`)) });
  assert.equal(ok.statusCode, 200);
  assert.ok(ok.json().text.includes('\n'));
  assert.doesNotMatch(ok.json().text, /2026-04-14|14\.04\.2026/);
  const foreign = await app.inject({ method: 'POST', url: '/labs/sample', ...multipartPdf(Buffer.from('plain text')) });
  assert.equal(foreign.statusCode, 415);
  const scan = await app.inject({ method: 'POST', url: '/labs/sample', ...multipartPdf(BLANK_PDF) });
  assert.equal(scan.json().error, 'sample_no_text');
  await app.close();
});

test('POST /labs/sample/send: nothing leaves without an address, without consent or with no text', async () => {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return new Response('{}', { status: 201 }); };
  const app = await samplesApp();
  const send = (payload) => app.inject({ method: 'POST', url: '/labs/sample/send', payload });
  const good = { labName: 'Лаборатория', text: 'Гемоглобин 777 г/л', consent: true };
  try {
    delete process.env.LAB_SAMPLES_URL;
    assert.equal((await send(good)).json().error, 'samples_off');
    process.env.LAB_SAMPLES_URL = 'https://samples.test/api/samples';
    assert.equal((await send({ ...good, consent: false })).statusCode, 400);
    assert.equal((await send({ ...good, text: '  ' })).statusCode, 400);
    assert.equal(calls.length, 0);
    assert.equal((await send(good)).statusCode, 200);
    assert.equal(calls[0].url, 'https://samples.test/api/samples');
    assert.deepEqual(Object.keys(calls[0].body).sort(), ['appVersion', 'labName', 'text']);
    globalThis.fetch = async () => new Response('', { status: 500 });
    assert.equal((await send(good)).json().error, 'sample_send_failed');
  } finally { globalThis.fetch = real; delete process.env.LAB_SAMPLES_URL; await app.close(); }
});
