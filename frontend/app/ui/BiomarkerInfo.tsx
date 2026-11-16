'use client';

import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { useProtocol } from './protocol';
import type { Messages } from '../i18n/messages';

type BiomarkerKey = keyof Messages['biomarkers'];

/** Catalog key → its description in locales/ru/biomarkers.json (JSON keys allow only letters, digits and _). */
const BIOMARKER_DB: Record<string, BiomarkerKey> = {
  ALT: 'ALT',
  AST: 'AST',
  CREA: 'CREA',
  HGB: 'HGB',
  WBC: 'WBC',
  PLT: 'PLT',
  'NEUT#': 'NEUT_abs',
  'NEUT%': 'NEUT_pct',
  TSH: 'TSH',
  TAC: 'TAC',
  HbA1c: 'HbA1c',
  eAG: 'eAG',
};

/** testKey must be a catalog key (ALT, HGB, NEUT#…); descriptions are keyed by it. */
export default function BiomarkerInfo({ testKey }: { testKey: string | null | undefined }) {
  const [open, setOpen] = useState(false);
  const protocol = useProtocol();
  const t = useTranslations('labs');
  const tb = useTranslations('biomarkers');
  const key = testKey && BIOMARKER_DB[testKey] ? testKey : null;
  if (!key) return null;
  const info = BIOMARKER_DB[key];
  if (!info) return null;
  const note = protocol?.markerNotes?.[key];

  return (
    <div style={{ marginBottom: 12 }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          background: 'none',
          border: 'none',
          padding: '6px 0',
          cursor: 'pointer',
          fontSize: 13,
          color: 'var(--accent)',
          fontWeight: 500,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <span style={{
          display: 'inline-block',
          transition: 'transform 0.15s',
          transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
          fontSize: 10,
        }}>&#9654;</span>
        {open ? t('biomarkerInfo.hide') : t('biomarkerInfo.show')}
      </button>

      {open && (
        <div style={{
          background: 'var(--surface-2)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: '14px 18px',
          fontSize: 13,
          lineHeight: 1.6,
          marginTop: 4,
        }}>
          <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 14 }}>{tb(`${info}.fullName`)}</div>

          <div style={{ marginBottom: 10 }}>
            <span style={{ fontWeight: 600, color: 'var(--fg-2)' }}>{t('biomarkerInfo.what')}</span>
            {tb(`${info}.what`)}
          </div>

          <div style={{ marginBottom: 10 }}>
            <span style={{ fontWeight: 600, color: 'var(--fg-2)' }}>{t('biomarkerInfo.whyMatters')}</span>
            {tb(`${info}.whyMatters`)}
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 10,
            marginBottom: 10,
          }}>
            <div style={{
              background: 'var(--hi-bg)',
              borderRadius: 8,
              padding: '10px 12px',
            }}>
              <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--hi-fg)', marginBottom: 4 }}>
                &#9650; {t('biomarkerInfo.high')}
              </div>
              <div style={{ fontSize: 12 }}>{tb(`${info}.highMeans`)}</div>
            </div>
            <div style={{
              background: 'var(--lo-bg)',
              borderRadius: 8,
              padding: '10px 12px',
            }}>
              <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--lo-fg)', marginBottom: 4 }}>
                &#9660; {t('biomarkerInfo.low')}
              </div>
              <div style={{ fontSize: 12 }}>{tb(`${info}.lowMeans`)}</div>
            </div>
          </div>

          {note && protocol && (
            <div style={{
              background: 'var(--accent-soft)',
              borderRadius: 8,
              padding: '10px 12px',
              fontSize: 12,
            }}>
              <span style={{ fontWeight: 600, color: 'var(--accent)' }}>{protocol.name}: </span>
              {note}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export { BIOMARKER_DB };
