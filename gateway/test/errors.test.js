import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CoreError, invalid, notFound, conflict, errorBody, HTTP_STATUS } from '../src/lib/errors.js';

test('CoreError keeps the response bodies routes used to send', () => {
  assert.deepEqual(errorBody(notFound()), { error: 'not_found' });
  assert.deepEqual(errorBody(notFound('medication_not_found')), { error: 'medication_not_found' });
  assert.deepEqual(errorBody(invalid('future', 'Будущие дни отмечать нельзя')), { error: 'future', message: 'Будущие дни отмечать нельзя' });
  assert.deepEqual(errorBody(conflict('already_recorded', 'Уже отмечено', { existing: { id: 1 } })), { error: 'already_recorded', message: 'Уже отмечено', existing: { id: 1 } });
  const e = invalid('bad_range');
  assert.ok(e instanceof CoreError && e instanceof Error);
  assert.equal(HTTP_STATUS[e.kind], 400);
  assert.equal(HTTP_STATUS[notFound().kind], 404);
  assert.equal(HTTP_STATUS[conflict('x').kind], 409);
});
