import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, passwordProblem, legacyPasswordProblem, MIN_PASSWORD_LENGTH } from '../src/lib/password.js';

test('a new password: ten characters at least', () => {
  assert.equal(MIN_PASSWORD_LENGTH, 10);
  assert.equal(passwordProblem('short'), 'short');
  assert.equal(passwordProblem('kR7#mPq2v'), 'short', 'nine characters');
  assert.equal(passwordProblem('kR7#mPq2vL'), null, 'ten');
  assert.equal(passwordProblem(''), 'short');
  assert.equal(passwordProblem(undefined), 'short');
});

test('a new password: phrases and random strings pass', () => {
  for (const p of ['correct horse battery', 'brand new password', 'yet another password', 'kR7#mPq2vLx9', 'трамвай едет в депо', 'my dog likes 7 bones', 'lenvatinib-24mg']) {
    assert.equal(passwordProblem(p), null, p);
  }
});

test('a new password: not digits only, not a few repeated characters', () => {
  for (const p of ['1234567890', '0000000000', '19850412 1985', '31.12.1999-01', 'aaaaaaaaaaaa', 'ababababab', 'xyxyxyxyxyzz', '!!!!!!!!!!!!']) {
    assert.equal(passwordProblem(p), 'weak', p);
  }
});

test('a new password: not a keyboard or alphabet walk, in either layout, forward or backward', () => {
  for (const p of ['qwertyuiop12', 'asdfgh-123456', 'abcdefghijkl', 'poiuytrewq', 'zxcvbnm,./asdf', '1q2w3e4r5t6y', 'qazwsxedcrfv', 'йцукенгшщз', 'фывапролдж', 'абвгдеёжзий', 'zyxwvutsrq', 'qwe-rty-uio-p', 'qweasdzxc123']) {
    assert.equal(passwordProblem(p), 'weak', p);
  }
});

test('a new password: not a common password with digits and punctuation around it', () => {
  for (const p of [
    'Password2024!', 'password123', 'P@ssw0rd123', '123password', 'passwordpassword', 'Qwerty123456', 'admin12345', 'letmein2024',
    'MedControl2026', 'medcontrol!!', 'Med-Control1', 'МедКонтроль1', 'Пароль12345', 'gfhjkm1234567', 'Natasha1990!', 'sasha-sasha', 'Zdorovie2025',
    'iloveyou123', 'changeme!!!', 'welcome2025', 'administrator',
  ]) {
    assert.equal(passwordProblem(p), 'weak', p);
  }
});

test('DTC_PASSWORD keeps the rule it was accepted under: eight characters and not one of the old words', () => {
  assert.equal(legacyPasswordProblem('short'), 'short');
  assert.equal(legacyPasswordProblem('password'), 'weak');
  assert.equal(legacyPasswordProblem('MedControl'), 'weak');
  assert.equal(legacyPasswordProblem('12345678'), 'weak');
  // accepted before, refused for a new password now: such an install starts with a warning
  for (const p of ['hunter42', 'Password2024!', '1234567890', 'qwertyuiop']) {
    assert.equal(legacyPasswordProblem(p), null, p);
    assert.notEqual(passwordProblem(p), null, p);
  }
});

test('scrypt hash verifies only the right password and rejects garbage', () => {
  const h = hashPassword('correct horse battery');
  assert.match(h, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  assert.equal(verifyPassword('correct horse battery', h), true);
  assert.equal(verifyPassword('wrong', h), false);
  assert.equal(verifyPassword('x', 'not-a-hash'), false);
  assert.notEqual(hashPassword('a'), hashPassword('a'), 'salted');
});

test('a stored password that the present rule would refuse still verifies', () => {
  const old = hashPassword('hunter42');
  assert.equal(passwordProblem('hunter42'), 'short');
  assert.equal(verifyPassword('hunter42', old), true);
});
