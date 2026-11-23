'use client';

import { useParams, useSearchParams } from 'next/navigation';

/**
 * The iPad build is a static export (`NEXT_PUBLIC_STATIC_EXPORT`): Next can emit one HTML file per
 * dynamic segment, so the record id travels in `?id=` (`/notes/_?id=`, `/labs/documents/_?id=`).
 * The server and desktop editions keep `/notes/<id>` and `/labs/documents/<id>`.
 */
const STATIC = process.env.NEXT_PUBLIC_STATIC_EXPORT === '1';

/** Rewrite a detail-page href for the static export. Other hrefs pass through, including on the server. */
export function staticDetailHref(href: string): string {
  if (!STATIC) return href;
  const hashAt = href.indexOf('#');
  const hash = hashAt >= 0 ? href.slice(hashAt) : '';
  const before = hashAt >= 0 ? href.slice(0, hashAt) : href;
  const q = before.indexOf('?');
  const path = q >= 0 ? before.slice(0, q) : before;
  const search = q >= 0 ? before.slice(q + 1) : '';
  const note = path.match(/^\/notes\/([^/]+)\/?$/);
  if (note && note[1] !== '_') {
    const params = new URLSearchParams(search);
    params.set('id', decodeURIComponent(note[1]));
    return `/notes/_?${params}${hash}`;
  }
  const doc = path.match(/^\/labs\/documents\/([^/]+)\/?$/);
  if (doc && doc[1] !== '_') {
    const params = new URLSearchParams(search);
    params.set('id', decodeURIComponent(doc[1]));
    return `/labs/documents/_?${params}${hash}`;
  }
  return href;
}

export function noteHref(id: string, query?: Record<string, string>): string {
  const qs = query && Object.keys(query).length ? `?${new URLSearchParams(query)}` : '';
  return staticDetailHref(`/notes/${encodeURIComponent(id)}${qs}`);
}

export function labDocumentHref(id: string): string {
  return staticDetailHref(`/labs/documents/${encodeURIComponent(id)}`);
}

/** Id from `?id=` (static export) or from the path segment (server and desktop). */
export function useRecordId(): string {
  const params = useParams<{ id?: string | string[] }>();
  const sp = useSearchParams();
  const fromQuery = sp.get('id');
  if (STATIC && fromQuery) return fromQuery;
  const raw = params?.id;
  const id = Array.isArray(raw) ? raw[0] : raw;
  return id && id !== '_' ? id : '';
}
