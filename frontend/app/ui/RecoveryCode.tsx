'use client';

import { useState } from 'react';
import { useTranslations } from 'use-intl';
import Icon from './icons';
import { todayKey } from './api';

/**
 * A freshly issued recovery code, shown once: after the wizard, after a reset by the code, after a new code in Settings.
 * The user must confirm it is written down or saved before going on.
 */
export default function RecoveryCode({ code, onDone, doneLabel }: { code: string; onDone: () => void; doneLabel?: string }) {
  const t = useTranslations('settings');
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  function download() {
    const text = t('recoveryCode.file', { code, date: todayKey() });
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'medcontrol-recovery-code.txt';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="msg msg--warning" style={{ lineHeight: 1.5 }}>
        {t.rich('recoveryCode.warning', { b: (c) => <b>{c}</b> })}
      </div>
      <code style={{ fontSize: 22, letterSpacing: 1, textAlign: 'center', padding: '12px 8px', wordBreak: 'break-all', userSelect: 'all' }}>{code}</code>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn--secondary btn--sm" onClick={() => navigator.clipboard?.writeText(code).then(() => setCopied(true)).catch(() => {})}>{copied ? t('recoveryCode.copied') : t('recoveryCode.copy')}</button>
        <button type="button" className="btn btn--secondary btn--sm" onClick={download}><Icon name="download" size={18} />{t('recoveryCode.download')}</button>
      </div>
      <div className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>{t('recoveryCode.keepApart')}</div>
      <label className="choice-row"><input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} /><span>{t('recoveryCode.saved')}</span></label>
      <div><button type="button" className="btn btn--primary" disabled={!saved} onClick={onDone}>{doneLabel ?? t('recoveryCode.continue')}</button></div>
    </div>
  );
}
