'use client';

import { useEdition } from './edition';

/** Picks the wording for this installation: the server edition or the desktop app (frontend/app/ui/edition.ts). */
export default function EditionText({ server, desktop }: { server: React.ReactNode; desktop: React.ReactNode }) {
  const ed = useEdition();
  return <>{ed.desktop ? desktop : server}</>;
}
