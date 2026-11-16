/**
 * Server or desktop edition (docs/DESKTOP.md). One code base: DTC_EDITION=desktop switches off what a desktop app
 * cannot do, and the interface keeps those features in place with «доступно только в серверной версии».
 */
import { conflict } from './errors.js';

export const edition = () => (String(process.env.DTC_EDITION || '').trim().toLowerCase() === 'desktop' ? 'desktop' : 'server');

/**
 * Server-only features and why, as codes (the interface words them):
 *  appleHealth — the phone sends data to a server address; a desktop app has none on the internet;
 *  dicom       — the DICOM archive is a separate service (Orthanc);
 *  backups     — night backups, the second disk and the cloud copy are a server service;
 *  passkeys    — passkeys are bound to a web address; the desktop app signs in with the password;
 *  egress      — the VPN proxy for AI and Telegram is a server container.
 */
export const SERVER_ONLY = ['appleHealth', 'dicom', 'backups', 'passkeys', 'egress'];

export const available = (feature) => edition() === 'server' || !SERVER_ONLY.includes(feature);

/** Throws CoreError conflict `server_only` (409) when the feature is off in this edition. */
export function requireFeature(feature) {
  if (!available(feature)) throw conflict('server_only', undefined, { feature });
}

/** For the interface (GET /edition, no sign-in needed: the login page hides the passkey button with it). */
export const editionInfo = () => ({ edition: edition(), unavailable: edition() === 'desktop' ? [...SERVER_ONLY] : [] });
