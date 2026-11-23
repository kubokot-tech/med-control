'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'use-intl';
import BottomSheet from './BottomSheet';
import { apiFetch } from './labUtils';
import { errorRu } from './api';
import FileButton from './FileButton';

/** navigator.clipboard exists only on https and localhost; a home server on plain http needs the old way. */
async function copyText(text: string, area: HTMLTextAreaElement | null) {
  try { await navigator.clipboard.writeText(text); return; } catch { /* below */ }
  area?.select();
  document.execCommand('copy');
}

/**
 * «Your laboratory is not on the list»: a PDF becomes anonymized text in the sheet, the person reads it, may correct it
 * and sends it or copies it. Without a file the button asks for one; with a file (a report just uploaded) it starts at once.
 * `send` is false while LAB_SAMPLES_URL is empty: then only copying is offered. See docs/LAB-PARSERS.md.
 */
export default function LabSampleInvite({ send, file }: { send: boolean; file?: File }) {
  const t = useTranslations('labs');
  const area = useRef<HTMLTextAreaElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [labName, setLabName] = useState('');
  const [checked, setChecked] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sent, setSent] = useState(false);

  async function prepare(f: File) {
    setOpen(true); setBusy(true); setErr(null); setText(''); setChecked(false); setCopied(false); setSent(false);
    try {
      const fd = new FormData();
      fd.append('file', f);
      const r = await apiFetch('/api/gateway/labs/sample', { method: 'POST', body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(errorRu(j));
      setText(j.text);
    } catch (e: any) { setErr(String(e?.message || e)); } finally { setBusy(false); }
  }

  async function submit() {
    setBusy(true); setErr(null);
    try {
      const r = await apiFetch('/api/gateway/labs/sample/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ labName, text, consent: true }),
      });
      if (!r.ok) throw new Error(errorRu(await r.json().catch(() => ({}))));
      setSent(true);
    } catch (e: any) { setErr(String(e?.message || e)); } finally { setBusy(false); }
  }

  const ready = checked && labName.trim() && text.trim() && !busy;

  return (
    <>
      {file ? (
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => prepare(file)}>{t('sample.fromFile')}</button>
      ) : (
        <div className="lab-sample-invite">
          <div className="muted">{t('sample.invite')}</div>
          <FileButton className="btn btn--ghost btn--sm" accept="application/pdf" onFiles={(files) => { const f = files[0]; if (f) prepare(f); }}>{t('sample.pick')}</FileButton>
        </div>
      )}

      <BottomSheet open={open} onClose={() => setOpen(false)} title={t('sample.title')}>
        {busy && !text && <div className="muted">{t('sample.preparing')}</div>}
        {err && <div className="msg msg--error">{err}</div>}
        {sent && <div className="msg msg--ok">{t('sample.thanks')}</div>}
        {/* A bare label would click the input programmatically, which the iPad web view ignores: use the same control. */}
        {sent && !file && <FileButton className="btn btn--ghost" accept="application/pdf" onFiles={(files) => { const f = files[0]; if (f) prepare(f); }}>{t('sample.another')}</FileButton>}
        {text && !sent && (
          <div className="lab-sample">
            <div className="muted">{t('sample.intro')}</div>
            <div className="msg msg--warn">{t('sample.check')}</div>
            <label className="field">
              <span>{t('sample.textLabel')}</span>
              <textarea ref={area} className="lab-sample__text" rows={14} spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} />
            </label>
            <div className="muted">{t('sample.restore')}</div>
            {send ? (
              <>
                <label className="field">
                  <span>{t('sample.labName')}</span>
                  <input value={labName} maxLength={200} onChange={(e) => setLabName(e.target.value)} />
                </label>
                <label className="choice-row">
                  <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
                  <span>{t('sample.consent')}</span>
                </label>
                <div className="muted">{t('sample.whereTo')}</div>
              </>
            ) : (
              <div className="muted">{t('sample.offNote')}</div>
            )}
            <div className="lab-sample__actions">
              {send && <button type="button" className="btn" disabled={!ready} onClick={submit}>{t('sample.send')}</button>}
              <button type="button" className={send ? 'btn btn--ghost' : 'btn'} onClick={async () => { await copyText(text, area.current); setCopied(true); }}>
                {copied ? t('sample.copied') : t('sample.copy')}
              </button>
            </div>
          </div>
        )}
      </BottomSheet>
    </>
  );
}
