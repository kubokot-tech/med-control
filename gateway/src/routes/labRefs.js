import { getRefSettings, setSex, setOverride, clearOverride } from '../lib/labRefs.js';
import { userLabUnits, displayRange } from '../lib/labDisplay.js';
import { markerName, markerShort } from '../lib/canonical.js';

/** Reference ranges: built-in, the user's own, the patient's sex (docs/REFERENCE-RANGES.md). Values in display units. */
export default async function labRefsRoutes(app) {
  app.get('/labs/refs', { preHandler: app.authenticate }, async (req) => {
    const [s, u] = await Promise.all([getRefSettings(req.user.sub), userLabUnits(req.user.sub)]);
    return {
      ...s,
      items: s.items.map((it) => ({
        ...it,
        name: markerName(it.key, u.language),
        short: markerShort(it.key, u.language),
        unit: u.unit(it.key, it.unit),
        builtIn: it.builtIn && { any: displayRange(u, it.key, it.builtIn.any), m: displayRange(u, it.key, it.builtIn.m), f: displayRange(u, it.key, it.builtIn.f) },
        inForce: displayRange(u, it.key, it.inForce),
        override: displayRange(u, it.key, it.override),
      })),
    };
  });
  app.put('/labs/refs', { preHandler: app.authenticate }, async (req) => {
    const sex = req.body?.sex ?? null;
    return { ok: true, sex: await setSex(req.user.sub, sex) };
  });
  // the user types the range in display units; it is stored in the catalog unit
  app.put('/labs/refs/:key', { preHandler: app.authenticate }, async (req) => {
    const key = String(req.params.key);
    const u = await userLabUnits(req.user.sub);
    const b = req.body || {};
    const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? v : u.fromDisplay(key, v));
    const saved = await setOverride(req.user.sub, key, { ...b, low: num(b.low), high: num(b.high) });
    return { ok: true, override: displayRange(u, key, saved) };
  });
  app.delete('/labs/refs/:key', { preHandler: app.authenticate }, async (req) => {
    await clearOverride(req.user.sub, String(req.params.key));
    return { ok: true };
  });
}
