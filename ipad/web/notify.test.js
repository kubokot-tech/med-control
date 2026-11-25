import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { nextDoseDay } from '../../gateway/src/lib/schedule.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const script = readFileSync(new URL('./mc-notify.js', import.meta.url), 'utf8');
const current = new Date(2026, 10, 24, 8).getTime();
class Clock extends Date {
  constructor(...args) { super(...(args.length ? args : [current])); }
  static now() { return current; }
}

async function notifications(regimens, alerts = []) {
  const sent = [];
  const state = new Map([['dtc_token', 'test'], ['mc_sample_note', '1']]);
  const window = {
    __TAURI_INTERNALS__: {}, mcGateway: { nextDoseDay }, addEventListener() {}, mcWords: { load: () => ({}), fmt: () => '' },
    __TAURI_PLUGIN_NOTIFICATION__: {
      Schedule: { at: (date) => date }, isPermissionGranted: () => true, registerActionTypes() {},
      onAction: async () => {}, cancelAll() {}, sendNotification: (note) => sent.push(note),
    },
  };
  const responses = { regimens: { regimens }, alerts: { alerts }, status: { schedule: { doseAt: '10:00', doseAgainAt: '20:00' } } };
  vm.runInNewContext(script, {
    window, Date: Clock, console, document: { addEventListener() {} }, setInterval() {},
    fetch: async (url) => ({ ok: true, json: () => responses[url.split('/').pop()] || {} }),
    localStorage: { getItem: (k) => state.get(k), setItem: (k, v) => state.set(k, v) },
  });
  await new Promise((resolve) => setImmediate(resolve));
  return { sent, state };
}

const item = { id: 'item', medication: { id: 'med', role: 'systemic' }, timesPerDay: 1 };

test('uses the regimen start and exclusive end for interval doses', async () => {
  const { sent } = await notifications([{ startDate: '2026-11-23', endDate: '2026-11-27', items: [{ ...item, frequencyRule: 'EVERY_N_DAYS', intervalDays: 3 }] }]);
  assert.deepEqual(sent.filter((x) => x.extra).map((x) => x.extra.day), ['2026-11-26', '2026-11-26']);
});

test('completed or paused doses suppress only the affected day', async () => {
  for (const status of ['TAKEN', 'PAUSED']) {
    const { sent } = await notifications([{ startDate: '2026-11-01', items: [{ ...item, today: { marks: [{ status }] } }] }]);
    const nextDose = sent.find((x) => x.extra);
    assert.equal(nextDose.extra.day, '2026-11-25');
  }
});

test('immediate alerts survive a full future queue', async () => {
  const { sent, state } = await notifications([{ startDate: '2026-11-01', items: [item] }], [{ id: 'alert-1', message: 'fixture' }]);
  assert.equal(sent.filter((x) => x.schedule).length, 60);
  assert.equal(sent.filter((x) => x.body === 'fixture').length, 1);
  assert.deepEqual(JSON.parse(state.get('mc_alert_notes')), ['alert-1']);
});
