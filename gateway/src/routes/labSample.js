/**
 * A sample of a lab report for adding its laboratory: docs/LAB-PARSERS.md, «Образец бланка». The first route turns a PDF
 * into anonymized text and keeps nothing; the second sends the text the user has read and agreed to send. The address
 * comes only from LAB_SAMPLES_URL; while it is empty nothing can leave and the interface offers copying instead.
 */
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { egressFetch } from '../lib/egress.js';
import { labSampleFromPdf, SAMPLE_MAX_CHARS } from '../lib/labSample.js';
import { firstFilePart } from '../lib/multipart.js';

const VERSION = (() => { try { return JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version; } catch { return '0'; } })();

export const labSamplesUrl = () => (process.env.LAB_SAMPLES_URL || '').trim();

const SendBody = z.object({
  labName: z.string().trim().min(1).max(200),
  text: z.string().trim().min(1).max(SAMPLE_MAX_CHARS),
  consent: z.literal(true),
});

export default async function labSampleRoutes(app) {
  app.post('/labs/sample', { preHandler: app.authenticate }, async (req, reply) => {
    const { buf } = await firstFilePart(req);
    if (!buf?.length) return reply.code(400).send({ error: buf ? 'empty_file' : 'file_required' });
    try {
      return await labSampleFromPdf(buf);
    } catch (e) {
      if (e.code === 'not_pdf') return reply.code(415).send({ error: 'not_pdf' });
      if (e.code === 'sample_no_text') return reply.code(422).send({ error: 'sample_no_text' });
      throw e;
    }
  });

  app.post('/labs/sample/send', { preHandler: app.authenticate }, async (req, reply) => {
    const url = labSamplesUrl();
    if (!url) return reply.code(409).send({ error: 'samples_off' });
    const parsed = SendBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });
    // the samples service refuses control characters (samples/server.js); a PDF's text layer may carry stray ones
    const clean = (s, keep) => s.replace(/\r\n?/g, '\n').replace(keep ? /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g : /[\u0000-\u001f\u007f-\u009f]/g, ' ');
    const labName = clean(parsed.data.labName, false).trim();
    const text = clean(parsed.data.text, true);
    let r;
    try {
      r = await egressFetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ labName, text, appVersion: VERSION }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      return reply.code(502).send({ error: 'sample_send_failed' });
    }
    if (!r.ok) return reply.code(502).send({ error: 'sample_send_failed' });
    return { ok: true };
  });
}
