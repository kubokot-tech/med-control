/** Pure helpers for notes: markdown import parsing and excerpts (no database). */
export function excerptOf(body, n = 220) {
  return String(body || '').replace(/^---[\s\S]*?---\s*/, '').replace(/[#>*_`\[\]()!]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
}

/** YAML-ish front matter (title, tags, url, source) and the first heading of an imported markdown file. */
export function parseMarkdownImport(text, filename) {
  let body = String(text || '').replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const meta = {};
  const fm = /^---\n([\s\S]*?)\n---\n?/.exec(body);
  if (fm) {
    for (const line of fm[1].split('\n')) {
      const m = /^([A-Za-zА-Яа-я_][\w-]*)\s*:\s*(.*)$/.exec(line);
      if (m) meta[m[1].toLowerCase()] = m[2].trim().replace(/^["']|["']$/g, '');
    }
    body = body.slice(fm[0].length);
  }
  let title = meta.title || meta.заголовок || '';
  const h1 = /^#\s+(.+)$/m.exec(body);
  if (!title && h1) { title = h1[1].trim(); body = body.replace(h1[0], '').replace(/^\n+/, ''); }
  if (!title) title = String(filename || 'Заметка').replace(/\.(md|markdown|txt)$/i, '').replace(/[_-]+/g, ' ').trim() || 'Заметка';
  const tags = String(meta.tags || meta.теги || '').replace(/^\[|\]$/g, '').split(/[,;]/).map((t) => t.trim().replace(/^#/, '').toLowerCase()).filter(Boolean);
  const rawUrl = meta.url || meta.source_url || meta.link || null;
  const url = rawUrl && /^https?:\/\//i.test(rawUrl) ? rawUrl : null; // never keep javascript:/data: links from imported files
  const sourceName = meta.source || meta.model || meta.author || meta.источник || null;
  return { title: title.slice(0, 200), body: body.trim(), tags: [...new Set(tags)].slice(0, 20), url, sourceName };
}

