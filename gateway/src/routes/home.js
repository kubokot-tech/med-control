import { homeHuman, resumeFromQuiet } from '../lib/homeHuman.js';
import { DEFAULT_TZ } from '../lib/dates.js';

/** The human side of the home screen: good news, quiet milestones, quiet mode (lib/homeHuman.js). */
export default async function homeRoutes(app) {
  app.get('/home/human', { preHandler: app.authenticate }, async (req) => homeHuman(req.user.sub, req.user.tz || DEFAULT_TZ));
  app.post('/home/quiet/resume', { preHandler: app.authenticate }, async (req) => resumeFromQuiet(req.user.sub, req.user.tz || DEFAULT_TZ));
}
