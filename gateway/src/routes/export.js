/**
 * Full data export: one ZIP with every table as JSON, labs as CSV, the anamnesis text and all uploaded files.
 * Meant for the patient's own archive and for moving to another system; not encrypted, keep it safe.
 */
import archiver from 'archiver';
import * as fileStore from '../lib/files.js';
import { transaction } from '../lib/db.js';
import { todayKey, DEFAULT_TZ } from '../lib/dates.js';
import { userLanguage } from '../lib/userLocale.js';
import { t } from '../lib/i18n.js';
import { displayUnit } from '../../../shared/units.js';
import { buildDossierMarkdown } from '../lib/dossierExport.js';
import { scrubTable } from '../lib/exportFilter.js';
import { importArchive, installationInUse } from '../lib/importArchive.js';
import { passwordConfirmed } from '../lib/auth.js';
import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const SKIP = new Set(['schema_migrations', 'passkeys']);
const csvCell = (v) => { const s = v == null ? '' : String(v); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export default async function exportRoutes(app) {
  // Markdown dossier for a general-purpose AI app (upload as a file into Claude / ChatGPT and ask there)
  app.get('/export/dossier.md', { preHandler: app.authenticate }, async (req, reply) => {
    const DAY = /^\d{4}-\d{2}-\d{2}$/;
    const q = req.query || {};
    const md = await buildDossierMarkdown(req.user.sub, {
      tz: req.user.tz || DEFAULT_TZ, from: DAY.test(q.from || '') ? q.from : undefined, to: DAY.test(q.to || '') ? q.to : undefined,
      withNotes: q.notes !== '0', withAi: q.ai === '1', allLabs: q.all_labs === '1', withDocs: q.docs !== '0',
    });
    const name = t(await userLanguage(req.user.sub), 'exportArchive.dossierName', { date: todayKey(req.user.tz || DEFAULT_TZ), ext: q.format === 'txt' ? 'txt' : 'md' });
    reply.header('Content-Type', q.format === 'txt' ? 'text/plain; charset=utf-8' : 'text/markdown; charset=utf-8');
    reply.header('Content-Disposition', `${q.inline === '1' ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`);
    return reply.send(md);
  });

  app.get('/export/all.zip', { preHandler: app.authenticate }, async (req, reply) => {
    const userId = req.user.sub;
    const today = todayKey(req.user.tz || DEFAULT_TZ);
    const language = await userLanguage(userId);
    const dir = path.join(fileStore.root(), 'tmp');
    await mkdir(dir, { recursive: true });
    const tmp = path.join(dir, `export-${randomUUID()}.zip`);
    const archive = archiver('zip', { zlib: { level: 6 } });
    const output = pipeline(archive, createWriteStream(tmp, { mode: 0o600, flags: 'wx' }));
    // A disk error during DB reads must terminate the producer as well as the writer.
    output.catch((e) => archive.destroy(e));
    const manifest = { exportedAt: new Date().toISOString(), tables: {}, files: {} };
    const required = new Map();
    let snapshotFiles;
    try {
      await transaction(async (client) => {
        await client.query('set transaction isolation level repeatable read, read only');
        const tables = (await client.query(`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`)).rows.map((r) => r.table_name).filter((t) => !SKIP.has(t));
        snapshotFiles = await fileStore.list('uploads', { recursive: true });
        const userCols = new Set((await client.query(`select table_name from information_schema.columns where table_schema = 'public' and column_name = 'user_id'`)).rows.map((r) => r.table_name));
        for (const t of tables) {
          const sql = t === 'app_settings' ? `select key, value, updated_at from app_settings` : t === 'users' ? `select id, email, timezone, locale, prefs, sex, created_at from users where id = $1` : userCols.has(t) ? `select * from "${t}" where user_id = $1` : `select * from "${t}"`;
          const rows = scrubTable(t, (await client.query(sql, userCols.has(t) || t === 'users' ? [userId] : [])).rows);
          if (t === 'attachments') {
            for (const row of rows) if (row.file_url) required.set(row.file_url, row.sha256);
          }
          if (t === 'app_settings') archive.append(rows.find((row) => row.key === 'anamnesis')?.value || '', { name: 'anamnesis.txt' });
          manifest.tables[t] = rows.length;
          archive.append(JSON.stringify(rows, null, 1), { name: `tables/${t}.json` });
        }
        const labs = await client.query(`select r.collected_at::date::text as date, t.code as test, t.canonical_key as key, r.value_numeric as value, r.value_text, r.unit_canonical as unit, r.unit_original, r.ref_low, r.ref_high, r.lab_name
                                         from lab_results r join lab_tests t on t.id = r.test_id where r.user_id = $1 order by r.collected_at, t.code`, [userId]);
        const head = ['date', 'test', 'key', 'value', 'value_text', 'unit', 'unit_original', 'ref_low', 'ref_high', 'lab_name'];
        // the machine columns keep their names and the «;»; the unit reads in the user's language, what the report printed stays
        const csvRows = labs.rows.map((r) => ({ ...r, unit: displayUnit(r.unit, language) }));
        archive.append('﻿' + [head.join(';'), ...csvRows.map((r) => head.map((h) => csvCell(r[h])).join(';'))].join('\n'), { name: 'labs.csv' });
        const notes = await client.query('select title, body, tags, url, source_name, created_at from notes where user_id = $1 order by created_at', [userId]);
        for (const [i, n] of notes.rows.entries()) {
          const safe = String(n.title).replace(/[\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'note';
          archive.append(`---\ntitle: ${n.title}\ntags: ${(n.tags || []).join(', ')}\n${n.url ? `url: ${n.url}\n` : ''}${n.source_name ? `source: ${n.source_name}\n` : ''}date: ${new Date(n.created_at).toISOString().slice(0, 10)}\n---\n\n${n.body}\n`, { name: `notes/${String(i + 1).padStart(3, '0')} ${safe}.md` });
        }
      });
      for (const f of snapshotFiles) {
        const bytes = await fileStore.read(f.ref);
        const digest = createHash('sha256').update(bytes).digest('hex');
        if (required.get(f.ref) && digest !== required.get(f.ref)) throw new Error('attachment checksum mismatch');
        required.delete(f.ref);
        const name = `files/${f.name.split(path.sep).join('/')}`;
        manifest.files[name] = digest;
        // Wait for this entry before loading the next attachment into memory.
        if (archive.destroyed) throw new Error('export stream closed');
        const consumed = new Promise((resolve, reject) => {
          const done = (item) => { if (item.name === name) { cleanup(); resolve(); } };
          const fail = (err) => { cleanup(); reject(err); };
          const cleanup = () => { archive.off('entry', done); archive.off('error', fail); };
          archive.on('entry', done).once('error', fail);
        });
        archive.append(bytes, { name });
        await consumed;
      }
      if (required.size) throw new Error('attachment missing during export');
      archive.append(JSON.stringify(manifest, null, 1), { name: 'manifest.json' });
      archive.append(t(language, 'exportArchive.readme', { date: today, pdf: '<sha256>.pdf' }), { name: 'README.txt' });
      await archive.finalize();
      await output;
      const stream = fileStore.stream(tmp);
      stream.once('close', () => rm(tmp, { force: true }).catch((e) => req.log.warn(e)));
      reply.header('Content-Type', 'application/zip');
      reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(t(language, 'exportArchive.zipName', { date: today }))}`);
      return reply.send(stream);
    } catch (e) {
      archive.destroy(e);
      await output.catch(() => {});
      await rm(tmp, { force: true });
      throw e;
    }
  });

  // Load a «Скачать все данные» archive into this installation (lib/importArchive.js): only while it has no patient
  // data, and with the password. multipart: field «password» first, then file «archive» (up to 2 GB, kept on disk).
  app.get('/import/status', { preHandler: app.authenticate }, async (req) => ({ empty: !(await installationInUse(req.user.sub)) }));
  app.post('/import/archive', { preHandler: app.authenticate }, async (req, reply) => {
    const tmpDir = path.join(fileStore.root(), 'tmp');
    await mkdir(tmpDir, { recursive: true });
    const tmp = path.join(tmpDir, `import-${randomUUID()}.zip`);
    let password = ''; let gotFile = false;
    try {
      for await (const p of req.parts({ limits: { fileSize: 2 * 1024 ** 3, files: 1, fields: 2 } })) {
        if (p.type === 'field' && p.fieldname === 'password') password = String(p.value || '');
        else if (p.type === 'file' && p.fieldname === 'archive') {
          if (!password) { p.file.resume(); return reply.code(400).send({ error: 'invalid_password' }); }
          req.body = { password };
          if (!(await passwordConfirmed(req, reply))) { p.file.resume(); return reply; }
          await pipeline(p.file, createWriteStream(tmp));
          if (p.file.truncated) return reply.code(413).send({ error: 'too_large' });
          gotFile = true;
        }
      }
      if (!gotFile) return reply.code(400).send({ error: 'file_required' });
      return { ok: true, ...(await importArchive(req.user.sub, tmp, { log: req.log })) };
    } finally {
      await rm(tmp, { force: true });
    }
  });
}
