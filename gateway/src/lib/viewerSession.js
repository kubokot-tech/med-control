/**
 * Access to the Orthanc viewer under /orthanc (Stone viewer, Orthanc Explorer, DICOMweb, read-only paths in the
 * Caddyfile). The browser never knows Orthanc's password: the «Снимки» page, opened in a signed-in session, gets a
 * short cookie limited to /orthanc; edge asks the gateway about every viewer request (forward_auth → /orthanc-auth),
 * and only then puts Orthanc's basic auth on it. «Выйти везде» and a new password end viewer access too.
 */
export const VIEWER_COOKIE = 'mc_viewer';
export const VIEWER_TTL_S = 8 * 3600;

/** Set-Cookie value: HttpOnly, only for /orthanc, never sent from other sites; Secure when the site is on https. */
export function viewerCookie(token, { secure = /^https:/i.test(process.env.APP_URL || '') } = {}) {
  return `${VIEWER_COOKIE}=${token}; Path=/orthanc; Max-Age=${VIEWER_TTL_S}; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;
}

/** The viewer token from a Cookie header, or ''. */
export function viewerTokenFrom(cookieHeader) {
  for (const part of String(cookieHeader || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === VIEWER_COOKIE) return v.join('=');
  }
  return '';
}
