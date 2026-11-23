import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'buffer';
import { inclusiveSlice } from './shims/range.js';

test('a ranged read uses an inclusive end, the way unzipper asks for a zip directory', () => {
  const buf = Buffer.from('abcdefghijklmnopqrstuvwxyz');
  assert.equal(inclusiveSlice(buf, 2, 5).toString(), 'cdef');
  assert.equal(inclusiveSlice(buf, 0, undefined).toString(), 'abcdefghijklmnopqrstuvwxyz');
  assert.equal(inclusiveSlice(buf, 24, 100).toString(), 'yz');
});
