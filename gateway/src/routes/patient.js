import { z } from 'zod';
import { patientCard, savePatientCard } from '../lib/patientCard.js';
import { todayKey, DEFAULT_TZ } from '../lib/dates.js';
import { invalidateProfileCache } from '../lib/patientProfile.js';
import { userLanguage } from '../lib/userLocale.js';
import { anamnesisFromFile } from '../lib/anamnesisFile.js';

/** Settings → «Анамнез» → «Пациент»: name, date of birth, diagnosis for the doctor report header, how the home screen addresses the patient (lib/patientCard.js). */
export default async function patientRoutes(app) {
  app.get('/settings/patient', { preHandler: app.authenticate }, async () => patientCard());
  // Text of a document for the anamnesis field; the file is not kept (lib/anamnesisFile.js).
  app.post('/settings/anamnesis/extract', { preHandler: app.authenticate }, async (req, reply) => {
    const part = await req.file();
    if (!part) return reply.code(400).send({ error: 'file_required' });
    const buf = await part.toBuffer();
    if (!buf?.length) return reply.code(400).send({ error: 'empty_file' });
    try {
      return await anamnesisFromFile(buf, part.filename, { language: await userLanguage(req.user.sub) });
    } catch (e) {
      if (['unsupported_file', 'no_text_in_file', 'ocr_failed', 'ingestion_failed'].includes(e.code)) return reply.code(422).send({ error: e.code });
      throw e;
    }
  });
  app.put('/settings/patient', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      const card = await savePatientCard(req.body, { today: todayKey(req.user.tz || DEFAULT_TZ) });
      invalidateProfileCache();
      return card;
    } catch (e) {
      if (e instanceof z.ZodError) return reply.code(400).send({ error: 'invalid_body', details: e.issues });
      throw e;
    }
  });
}
