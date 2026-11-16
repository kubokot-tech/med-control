/**
 * Desktop edition: the gateway listens on 127.0.0.1 only, but a web page of another site whose name resolves to
 * 127.0.0.1 (DNS rebinding) could still reach it from the browser. Requests must name this machine (127.0.0.1 or
 * localhost, this port or none); the app's own callers (the Next server, the launcher's health check) always do.
 */
export function desktopHostGuard(port) {
  // with or without the port: the launcher's health probe sends «Host: 127.0.0.1»; a rebinding page sends its own name
  const allowed = new Set([`127.0.0.1:${port}`, `localhost:${port}`, '127.0.0.1', 'localhost']);
  return async (req, reply) => {
    if (!allowed.has(String(req.headers.host || '').toLowerCase())) return reply.code(403).send({ error: 'forbidden' });
  };
}
