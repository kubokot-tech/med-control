/**
 * What the frontend's proxy to the gateway (frontend/app/api/gateway/[...path]/route.ts) lets through with a body but
 * without an Authorization header. The proxy holds a request body in memory before passing it on, up to 25 MB, so a
 * request that carries no credentials at all is answered before its body is read, except the few public routes below,
 * whose bodies are a password, a code or a passkey answer and get a small limit of their own.
 * Plain JavaScript here so that the gateway's tests cover it.
 */

/** Gateway routes that take a body from somebody who is not signed in yet: sign-in, recovery, the first-run wizard. */
export const PUBLIC_BODY_ROUTES = ['auth/login', 'auth/recover', 'auth/passkey/direct/options', 'auth/passkey/direct/verify', 'setup'];

/** The most such a body may weigh. A passkey answer is a few kilobytes; the wizard sends a password and a few keys. */
export const PUBLIC_BODY_LIMIT = 64 * 1024;

/**
 * How much of a body to accept: 'full' for a request with credentials (the gateway checks them), 'small' for a public
 * route without them, 'none' for anything else without them (the proxy answers 401).
 * `path`: the segments after /api/gateway/; `authorization`: the header as received.
 */
export function bodyAllowance(path, authorization) {
  if (String(authorization || '').trim()) return 'full';
  return PUBLIC_BODY_ROUTES.includes((path || []).join('/')) ? 'small' : 'none';
}
