import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { changelogSummary, englishPart, manifest, plain, PACKAGES } from '../../scripts/updater-manifest.mjs';

const CHANGELOG = `# История версий

## Не выпущено

## 0.4.0 — 1 декабря 2026

Обновления внутри приложения.

- **Сама обновляется**: [подробно](docs/DESKTOP.md), команда \`npm run build\`.

Подробно:

- длинный список

## 0.3.1 — 17 ноября 2026

- старое
`;

const BODY = `Небольшой выпуск.

## Скачать для компьютера

---

## English

Updates inside the app.

- The app updates itself, see the [docs](https://example.org).

Desktop installers for macOS and Windows are attached below.

MedControl is not a medical device.
`;

test('markdown becomes dialog text', () => {
  assert.equal(plain('- **Жирно**: [ссылка](a.md) и `код`\n\n\n\nдальше'), '• Жирно: ссылка и код\n\nдальше');
});

test('the Russian summary stops at «Подробно:»', () => {
  assert.equal(changelogSummary(CHANGELOG, '0.4.0'), 'Обновления внутри приложения.\n\n• Сама обновляется: подробно, команда npm run build.');
  assert.equal(changelogSummary(CHANGELOG, '0.3.1'), '• старое');
  assert.equal(changelogSummary(CHANGELOG, '9.9.9'), '');
});

test('the English part leaves out downloads and the disclaimer', () => {
  assert.equal(englishPart(BODY), 'Updates inside the app.\n\n• The app updates itself, see the docs.');
  assert.equal(englishPart('Только по-русски.'), '');
});

test('latest.json lists every package with its signature', () => {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-manifest-'));
  for (const f of Object.values(PACKAGES)) {
    fs.writeFileSync(path.join(dist, f), 'pkg');
    fs.writeFileSync(path.join(dist, `${f}.sig`), `sig-of-${f}\n`);
  }
  const m = manifest({ version: '0.4.0', repo: 'o/r', dist, changelog: CHANGELOG, releaseBody: BODY, now: new Date('2026-12-01T10:00:00.123Z') });
  assert.equal(m.version, '0.4.0');
  assert.equal(m.pub_date, '2026-12-01T10:00:00Z');
  assert.deepEqual(Object.keys(m.platforms).sort(), ['darwin-aarch64', 'darwin-x86_64', 'windows-x86_64']);
  assert.equal(m.platforms['darwin-aarch64'].url, 'https://github.com/o/r/releases/download/v0.4.0/MedControl-macOS-AppleSilicon.app.tar.gz');
  assert.equal(m.platforms['windows-x86_64'].signature, 'sig-of-MedControl-Windows-Setup.exe');
  const notes = JSON.parse(m.notes);
  assert.match(notes.ru, /^Обновления внутри приложения/);
  assert.match(notes.en, /^Updates inside the app/);
  const intelSignature = path.join(dist, `${PACKAGES['darwin-x86_64']}.sig`);
  fs.writeFileSync(intelSignature, '\n');
  assert.throws(() => manifest({ version: '0.4.0', repo: 'o/r', dist, changelog: CHANGELOG }), /empty package or signature/);
  fs.rmSync(intelSignature);
  assert.throws(() => manifest({ version: '0.4.0', repo: 'o/r', dist, changelog: CHANGELOG }), /MedControl-macOS-Intel/);
  fs.rmSync(dist, { recursive: true });
});
