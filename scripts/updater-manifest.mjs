#!/usr/bin/env node
// Builds latest.json for the desktop app's updater (docs/DESKTOP.md, «Обновления»).
// Usage: node scripts/updater-manifest.mjs <version> <owner/repo> <dist dir> [release body file] > latest.json
// <dist dir> holds the update packages under their fixed names, each with its .sig next to it (desktop.yml).
// The notes carry both languages as JSON {"ru", "en"}: Russian from the CHANGELOG section of the version (up to
// «Подробно:»), English from the «## English» part of the release text. The app shows the one of its system.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACKAGES = {
  'darwin-aarch64': 'MedControl-macOS-AppleSilicon.app.tar.gz',
  'darwin-x86_64': 'MedControl-macOS-Intel.app.tar.gz',
  'windows-x86_64': 'MedControl-Windows-Setup.exe',
};

/** Markdown to plain text for a dialog: no bold, links as their text, list markers as bullets. */
export function plain(md) {
  return md
    .split('\n')
    .map((l) => l
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/^\s*[-*] /, '• ')
      .trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** The CHANGELOG section of a version, up to «Подробно:» or the next version. */
export function changelogSummary(changelog, version) {
  const lines = changelog.split('\n');
  const start = lines.findIndex((l) => l.startsWith(`## ${version}`));
  if (start < 0) return '';
  const out = [];
  for (const l of lines.slice(start + 1)) {
    if (l.startsWith('## ') || l.startsWith('Подробно:')) break;
    out.push(l);
  }
  return plain(out.join('\n'));
}

/** The «## English» part of the release text, without the download and disclaimer lines. */
export function englishPart(body) {
  const at = body.indexOf('## English');
  if (at < 0) return '';
  const lines = body.slice(at + '## English'.length).split('\n');
  const out = [];
  for (const l of lines) {
    if (/^## /.test(l) || /^(Desktop installers|MedControl is not a medical device)/.test(l)) break;
    out.push(l);
  }
  return plain(out.join('\n'));
}

export function manifest({ version, repo, dist, changelog, releaseBody = '', now = new Date() }) {
  const platforms = {};
  for (const [key, file] of Object.entries(PACKAGES)) {
    const sig = path.join(dist, `${file}.sig`);
    if (!fs.existsSync(path.join(dist, file)) || !fs.existsSync(sig)) throw new Error(`missing ${file} or its .sig in ${dist}`);
    platforms[key] = {
      signature: fs.readFileSync(sig, 'utf8').trim(),
      url: `https://github.com/${repo}/releases/download/v${version}/${file}`,
    };
  }
  const notes = JSON.stringify({ ru: changelogSummary(changelog, version), en: englishPart(releaseBody) });
  return { version, notes, pub_date: now.toISOString().replace(/\.\d{3}Z$/, 'Z'), platforms };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [version, repo, dist, bodyFile] = process.argv.slice(2);
  if (!version || !repo || !dist) {
    console.error('usage: node scripts/updater-manifest.mjs <version> <owner/repo> <dist dir> [release body file]');
    process.exit(2);
  }
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  const releaseBody = bodyFile && fs.existsSync(bodyFile) ? fs.readFileSync(bodyFile, 'utf8') : '';
  process.stdout.write(`${JSON.stringify(manifest({ version: version.replace(/^v/, ''), repo, dist, changelog, releaseBody }), null, 2)}\n`);
}
