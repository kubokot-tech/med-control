import { searchAll } from '../lib/search.js';

/** Global search (lib/search.js). */
export default async function searchRoutes(app) {
  app.get('/search', { preHandler: app.authenticate }, async (req) => searchAll(req.user.sub, req.query?.q, { limit: parseInt(req.query?.limit || '60', 10) }));
}
