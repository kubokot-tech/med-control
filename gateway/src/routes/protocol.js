import { z } from 'zod';
import { DEFAULT_TZ } from '../lib/dates.js';
import { getProtocol, setProtocol, listPresets, protocolFromPreset, protocolIn, mergePresetScales, SETTING_KEY } from '../lib/protocol.js';
import { getSetting } from '../lib/settings.js';
import { catalog } from '../lib/canonical.js';
import { scaleCatalog } from '../lib/diaryScales.js';
import { addProtocolAgents } from '../lib/infusions.js';
import { createMedication, hasActiveSystemic } from '../lib/medsCreate.js';
import { displayUnit } from '../../../shared/units.js';
import { userLanguage } from '../lib/userLocale.js';

export default async function protocolRoutes(app) {
  // Current protocol, the presets and the catalog keys the rule editor can use.
  app.get('/protocol', { preHandler: app.authenticate }, async (req) => {
    const language = await userLanguage(req.user.sub);
    return {
      protocol: protocolIn(getProtocol(), language),
      stored: Boolean(getSetting(SETTING_KEY)),
      presets: listPresets(language),
      catalog: catalog(language).map((c) => ({ key: c.key, name: c.name, unit: displayUnit(c.unit, language) })),
      scaleCatalog: scaleCatalog(language),
    };
  });
  // Replace the protocol with the user's edited version.
  app.put('/protocol', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      const saved = await setProtocol(req.body || {});
      return { ok: true, protocol: protocolIn(saved, await userLanguage(req.user.sub)) };
    } catch (e) {
      if (e instanceof z.ZodError) return reply.code(400).send({ error: 'invalid_body', message: 'Протокол не сохранён: проверьте поля', details: e.issues });
      throw e;
    }
  });
  // Load a preset as the current protocol (the user's edits are replaced).
  app.post('/protocol/preset', { preHandler: app.authenticate }, async (req, reply) => {
    const id = String(req.body?.preset || '');
    const p = protocolFromPreset(id);
    if (!p) return reply.code(404).send({ error: 'preset_not_found' });
    // the user's own diary scales survive a preset change (mergePresetScales)
    const saved = await setProtocol(mergePresetScales(p, getProtocol()));
    return { ok: true, protocol: protocolIn(saved, await userLanguage(req.user.sub)) };
  });
  // Seed data from the protocol: the daily regimen (once, when there is no active systemic drug) and the infusion catalog.
  app.post('/protocol/apply', { preHandler: app.authenticate }, async (req) => {
    const userId = req.user.sub; const tz = req.user.tz || DEFAULT_TZ;
    const want = req.body || {};
    const language = await userLanguage(userId);
    const p = protocolIn(getProtocol(), language);
    const out = { regimen: null, agentsAdded: 0 };
    if (want.regimen) {
      if (!p.regimen) out.regimen = 'none';
      else if (await hasActiveSystemic(userId)) out.regimen = 'exists';
      else { await createMedication(userId, { ...p.regimen, startDate: want.startDate }, tz); out.regimen = 'created'; }
    }
    if (want.agents) out.agentsAdded = await addProtocolAgents(userId, language);
    return { ok: true, ...out };
  });
}
