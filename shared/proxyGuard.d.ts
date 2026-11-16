// Types for proxyGuard.js (plain JavaScript so that the gateway's tests run it without a build step).
export const PUBLIC_BODY_ROUTES: string[];
export const PUBLIC_BODY_LIMIT: number;
export function bodyAllowance(path: string[], authorization: string | null | undefined): 'full' | 'small' | 'none';
