import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdownImport, excerptOf } from '../src/lib/notesText.js';

test('front matter, first heading, tags, url', () => {
  const r = parseMarkdownImport('---\ntitle: "Лучевая терапия: статья"\ntags: [терапия, лучевая, #протоны]\nurl: https://example.org/x\nsource: ChatGPT\n---\n# Не этот заголовок\n\nТекст.', 'chat.md');
  assert.equal(r.title, 'Лучевая терапия: статья');
  assert.deepEqual(r.tags, ['терапия', 'лучевая', 'протоны']);
  assert.equal(r.url, 'https://example.org/x');
  assert.equal(r.sourceName, 'ChatGPT');
  assert.equal(r.body, '# Не этот заголовок\n\nТекст.');
});

test('heading becomes the title and is removed from the body; filename fallback', () => {
  const r = parseMarkdownImport('# Ленватиниб и гипертония\n\nАбзац.', 'x.md');
  assert.equal(r.title, 'Ленватиниб и гипертония');
  assert.equal(r.body, 'Абзац.');
  assert.equal(parseMarkdownImport('просто текст', 'claude_chat-2026.md').title, 'claude chat 2026');
});

test('excerpt strips markdown', () => {
  assert.equal(excerptOf('## Заголовок\n\n**жирный** и [ссылка](http://x)'), 'Заголовок жирный и ссылка http://x');
});
