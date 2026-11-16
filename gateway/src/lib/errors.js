/**
 * Expected failures of the core (wrong input, missing record, conflict), as opposed to bugs. Core modules throw
 * them without knowing about HTTP; the server's error handler turns a CoreError into a response with the same
 * body routes used to send by hand: { error: code, message?, ...extra }. A local build shows errorsRu[code].
 */
export class CoreError extends Error {
  constructor(kind, code, message, extra) {
    super(message || code);
    this.name = 'CoreError';
    this.kind = kind;
    this.code = code;
    this.userMessage = message || null;
    this.extra = extra || null;
  }
}

export const HTTP_STATUS = { invalid: 400, not_found: 404, conflict: 409 };

export const invalid = (code, message, extra) => new CoreError('invalid', code, message, extra);
export const notFound = (code = 'not_found', message, extra) => new CoreError('not_found', code, message, extra);
export const conflict = (code, message, extra) => new CoreError('conflict', code, message, extra);

/** Response body for a CoreError, as the routes sent it before the core was split out. */
export function errorBody(e) {
  return { error: e.code, ...(e.userMessage ? { message: e.userMessage } : {}), ...(e.extra || {}) };
}
