'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'use-intl';
import { apiFetch } from './labUtils';
import LabSampleInvite from './LabSampleInvite';

type Parser = { id: string; name: string };

export function useLabParsers() {
  const [data, setData] = useState<{ available: boolean; parsers: Parser[]; samples?: { send: boolean } } | null>(null);
  useEffect(() => { apiFetch('/api/gateway/labs/parsers').then(async (r) => { if (r.ok) setData(await r.json()); }); }, []);
  return data;
}

/** The built-in laboratories by name: Settings and the upload page show the same list. */
export function LabParserRows({ parsers }: { parsers: Parser[] }) {
  return (
    <div className="sheet__list">
      {parsers.map((p) => (
        <div key={p.id} className="list-row">{p.name}</div>
      ))}
    </div>
  );
}

/** Which laboratory reports are parsed without AI, and what happens with the rest. */
export default function LabsParsersCard() {
  const t = useTranslations('settings');
  const data = useLabParsers();

  return (
    <div className="card meds-card">
      <div className="meds-card__row">
        <div className="card__title">{t('labsParsersCard.title')}</div>
        {data && <span className={`pill ${data.available ? 'ok' : ''}`}>{data.available ? t('labsParsersCard.builtIn', { n: data.parsers.length }) : t('labsParsersCard.unavailable')}</span>}
      </div>
      <div className="muted" style={{ fontSize: 14, lineHeight: 1.5 }}>
        {t('labsParsersCard.intro')}
      </div>
      {data?.available && <LabParserRows parsers={data.parsers} />}
      {data && !data.available && <div className="msg msg--error">{t.rich('labsParsersCard.down', { code: (c) => <code>{c}</code> })}</div>}
      {data && <LabSampleInvite send={!!data.samples?.send} />}
    </div>
  );
}
