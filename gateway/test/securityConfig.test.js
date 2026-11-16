// Security settings that live outside the gateway's code: the egress filter, the backup scripts, the CI workflow.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = (p) => fileURLToPath(new URL(`../../${p}`, import.meta.url));
const read = (p) => readFileSync(root(p), 'utf8');

// set before backupStatus.js is imported: it reads the path once
const STATUS = path.join(mkdtempSync(path.join(tmpdir(), 'backup-status-')), 'status.json');
process.env.BACKUP_STATUS_FILE = STATUS;

test('egress filter: every host is anchored on both sides, so a look-alike does not pass', () => {
  const lines = read('egress/filter').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  assert.ok(lines.length >= 6);
  for (const l of lines) assert.match(l, /^\(\^\|\\\.\)[a-z0-9\\.-]+\$$/, l);
  assert.match(read('egress/tinyproxy.conf'), /^FilterType ere$/m, 'the anchors need extended regular expressions');
  assert.match(read('egress/tinyproxy.conf'), /^FilterDefaultDeny Yes$/m);
  const allowed = (host) => lines.some((l) => new RegExp(l).test(host));
  for (const h of ['openrouter.ai', 'api.anthropic.com', 'api.openai.com', 'api.deepseek.com', 'api.telegram.org', 'api.ipify.org', 'eu.openrouter.ai']) assert.equal(allowed(h), true, h);
  for (const h of ['evilopenrouter.ai', 'openrouter.ai.evil.example', 'xapi.telegram.org', 'api.telegram.org.evil.example', 'apiXtelegram.org', 'anthropic.com', 'example.com']) assert.equal(allowed(h), false, h);
});

test('CI: the workflow token can only read the repository', () => {
  const ci = read('.github/workflows/ci.yml');
  assert.match(ci, /^permissions:\n {2}contents: read\n/m, 'top level, for every job');
  assert.doesNotMatch(ci, /^\s+permissions:/m, 'no job widens it');
  assert.doesNotMatch(ci, /contents: write|write-all/);
});

/** The --exclude flags a script passes to tar for the data folder. */
function excludeFlags(script) {
  const flags = [...read(script).matchAll(/--exclude=\S+/g)].map((m) => m[0].replace(/[)"']+$/, ''));
  return [...new Set(flags)];
}

test('backups: the archive of the data folder has no session secret and no first-run code', () => {
  const data = mkdtempSync(path.join(tmpdir(), 'backup-data-'));
  mkdirSync(path.join(data, 'uploads', 'labs'), { recursive: true });
  writeFileSync(path.join(data, 'jwt.secret'), 'secret\n');
  writeFileSync(path.join(data, 'setup-code.txt'), 'AAAA-BBBB\n');
  writeFileSync(path.join(data, 'uploads', 'labs', 'abc.pdf'), '%PDF');
  writeFileSync(path.join(data, 'uploads', 'jwt.secret.pdf'), 'a document that only looks alike');
  for (const script of ['backup/backup-loop.sh', 'scripts/backup.sh']) {
    const flags = excludeFlags(script);
    assert.deepEqual(flags.sort(), ['--exclude=./jwt.secret', '--exclude=./setup-code.txt'], script);
    // the same tar call as in the script: flags first, then the folder
    assert.match(read(script), /tar czf \S+ (?:"\$\{DATA_EXCLUDE\[@\]\}"|--exclude=\.\/jwt\.secret --exclude=\.\/setup-code\.txt) -C \/data \./, script);
    const out = path.join(mkdtempSync(path.join(tmpdir(), 'backup-out-')), 'uploads.tar.gz');
    execFileSync('tar', ['czf', out, ...flags, '-C', data, '.']);
    const names = execFileSync('tar', ['tzf', out], { encoding: 'utf8' }).split('\n').filter(Boolean);
    assert.ok(names.includes('./uploads/labs/abc.pdf'), `${script}: the uploads are there`);
    assert.ok(names.includes('./uploads/jwt.secret.pdf'), `${script}: a file that only looks alike stays`);
    assert.ok(!names.some((n) => /(^|\/)jwt\.secret$/.test(n)), `${script}: jwt.secret is out`);
    assert.ok(!names.some((n) => /(^|\/)setup-code\.txt$/.test(n)), `${script}: setup-code.txt is out`);
  }
});

/** One shell function of a script, by name: from «name() {» to the closing brace on its own line (or a one-liner). */
function shellFunction(script, name) {
  const src = read(script);
  const one = new RegExp(`^${name}\\(\\) \\{ .* \\}$`, 'm').exec(src);
  if (one) return one[0];
  const m = new RegExp(`^${name}\\(\\) \\{\\n[\\s\\S]*?\\n\\}$`, 'm').exec(src);
  assert.ok(m, `${name}() in ${script}`);
  return m[0];
}

test('backups: a cloud remote that is not rclone crypt gets a loud warning and is still used', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'backup-rclone-'));
  const conf = path.join(dir, 'rclone.conf');
  writeFileSync(conf, '[yc]\ntype = s3\n\n[yc-crypt]\ntype = crypt\nremote = yc:bucket\n');
  const functions = ['cloud_on', 'cloud_type', 'cloud_check'].map((f) => shellFunction('backup/backup-loop.sh', f)).join('\n');
  // rclone itself is not needed: the stub answers like `rclone listremotes --long`
  const stub = 'rclone() { printf "yc:       s3\\nyc-crypt: crypt\\n"; }';
  const run = (remote, config = conf) => {
    const r = spawnSync('bash', ['-c', `set -uo pipefail\n${stub}\n${functions}\ncloud_crypt=null\ncloud_check\ncloud_on && echo "on" || echo "off"\necho "crypt=$cloud_crypt"`], { env: { PATH: process.env.PATH, CLOUD_REMOTE: remote, RCLONE_CONFIG: config }, encoding: 'utf8' });
    return { out: r.stdout.trim().split('\n'), err: r.stderr };
  };
  const plain = run('yc:medcontrol');
  assert.deepEqual(plain.out, ['on', 'crypt=false'], 'the copy is still made');
  assert.match(plain.err, /WARNING/);
  assert.match(plain.err, /CLOUD_REMOTE=yc:medcontrol is not an rclone crypt remote \(type: s3\)/);
  assert.match(plain.err, /UNENCRYPTED/);
  const crypt = run('yc-crypt:');
  assert.deepEqual(crypt.out, ['on', 'crypt=true']);
  assert.equal(crypt.err, '', 'no warning for a crypt remote');
  assert.deepEqual(run('yc-crypt:backups/of/home').out, ['on', 'crypt=true'], 'a folder inside the crypt remote');
  const local = run('/mnt/cloud-disk');
  assert.deepEqual(local.out, ['on', 'crypt=false'], 'a plain path is not encrypted either');
  assert.match(local.err, /type: unknown/);
  assert.match(run('typo:').err, /UNENCRYPTED/, 'an unknown remote name is not taken for crypt');
  const off = run('', conf);
  assert.deepEqual(off.out, ['off', 'crypt=null']);
  assert.equal(off.err, '');
  assert.deepEqual(run('yc:', path.join(dir, 'missing.conf')).out, ['off', 'crypt=null'], 'no rclone.conf: nothing is uploaded, nothing to warn about');
  // the result reaches status.json, and the check runs when the service starts and before every upload
  const script = read('backup/backup-loop.sh');
  assert.match(script, /"crypt":\$cloud_crypt/);
  assert.match(script, /^cloud_check {3}# /m);
  assert.match(shellFunction('backup/backup-loop.sh', 'step_cloud'), /^step_cloud\(\) \{\n {2}cloud_check\n/);
});

test('backups: the unencrypted cloud copy is in the Telegram line and the settings, without turning the backup red', async () => {
  const { backupStatus, backupLine } = await import('../src/lib/backupStatus.js');
  const { createFormat } = await import('../../shared/format.js');
  const status = (cloud) => ({ ran_at: new Date().toISOString(), dump_ok: true, dump_bytes: 5 * 1048576, uploads_bytes: 1048576, mirror: { enabled: false, state: 'skipped' }, cloud, restore_test: { state: 'skipped' } });

  writeFileSync(STATUS, JSON.stringify(status({ enabled: true, state: 'ok', remote: 'yc:', crypt: false })));
  for (const [language, word] of [['ru', /⚠️ Внимание: копия в облако уходит без шифрования/], ['en', /⚠️ Warning: the cloud copy is not encrypted/]]) {
    const b = await backupStatus(language);
    assert.equal(b.ok, true, 'existing setups keep working: not a failure, no alarm');
    assert.deepEqual(b.problems, []);
    assert.equal(b.warnings.length, 1);
    const line = backupLine(b, createFormat({ language, timeZone: 'UTC' }));
    assert.match(line, word);
    assert.match(line, /CLOUD_REMOTE/);
  }

  for (const cloud of [{ enabled: true, state: 'ok', remote: 'yc-crypt:', crypt: true }, { enabled: true, state: 'ok', remote: 'yc-crypt:' }, { enabled: false, state: 'skipped', remote: '', crypt: null }]) {
    writeFileSync(STATUS, JSON.stringify(status(cloud)));
    const b = await backupStatus('ru');
    assert.deepEqual(b.warnings, [], JSON.stringify(cloud));
    assert.doesNotMatch(backupLine(b), /⚠️/);
  }
});

test('DTC_PASSWORD: what started an install before still starts it, a weak one with a warning', async () => {
  const { envPasswordState } = await import('../src/lib/password.js');
  assert.deepEqual(envPasswordState(''), { fatal: '', warning: '' });
  assert.deepEqual(envPasswordState('correct horse battery'), { fatal: '', warning: '' });
  for (const p of ['hunter42', 'Password2024!', '1234567890', 'qwertyuiop']) {
    const s = envPasswordState(p);
    assert.equal(s.fatal, '', `${p} starts`);
    assert.match(s.warning, /DTC_PASSWORD in \.env is weak/);
    assert.ok(!s.warning.includes(p), 'the password itself is never in the log');
  }
  for (const p of ['short', 'password', 'medcontrol']) assert.match(envPasswordState(p).fatal, /at least 8 characters/, `${p} was refused before too`);
});
