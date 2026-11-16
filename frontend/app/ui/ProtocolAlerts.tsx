'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'use-intl';
import Icon from './icons';
import BottomSheet from './BottomSheet';
import { type LabRule } from './protocol';
import { useProtocolEdit } from './protocolEdit';
import { useFormat } from './format';

const OPS: LabRule['op'][] = ['lt', 'lte', 'gt', 'gte', 'gtRef', 'ltRef'];
const CHIPS = [['{v}', 'value'], ['{u}', 'unit'], ['{ref}', 'ref']] as const;
/** The alert text as the user will read it: the value becomes «…», the reference placeholders become the word for it. */
const preview = (m: string, norm: string) => m.replace(/\{v\}/g, '…').replace(/\s*\{u\}/g, '').replace(/\{ref(High|Low)?\}/g, () => norm);

/** Settings → Protocol → Alert thresholds: one line per rule, a sheet to edit it, Save for the page. */
export default function ProtocolAlerts() {
  const t = useTranslations('protocol');
  const f = useFormat();
  const { data, form, setForm, dirty, busy, msg, err, save, reset, catalogByKey } = useProtocolEdit();
  const [edit, setEdit] = useState<number | null>(null);
  const [draft, setDraft] = useState<LabRule | null>(null);
  const msgRef = useRef<HTMLInputElement>(null);

  if (!data || !form) return <div className="card meds-card"><div className="muted">{t('loading')}</div></div>;
  const keys = data.catalog.map((c) => c.key);
  const name = (k: string) => catalogByKey.get(k)?.name || k;
  const condition = (r: LabRule) => `${t(`op.${r.op}`)} ${f.number(r.value)}${r.op.endsWith('Ref') ? '' : catalogByKey.get(r.key)?.unit ? ` ${catalogByKey.get(r.key)!.unit}` : ''}`;

  const open = (i: number | null) => {
    setEdit(i);
    setDraft(i == null ? { key: keys[0] || 'ALT', severity: 'YELLOW', op: 'gt', value: 0, message: t('alerts.defaultMessage') } : { ...form.labRules[i] });
  };
  const close = () => { setEdit(null); setDraft(null); };
  const commit = () => {
    if (!draft) return;
    const rules = edit == null || edit < 0 ? [...form.labRules, draft] : form.labRules.map((r, j) => (j === edit ? draft : r));
    setForm({ ...form, labRules: rules }); close();
  };
  const remove = () => { if (edit != null && edit >= 0) setForm({ ...form, labRules: form.labRules.filter((_, j) => j !== edit) }); close(); };
  const insertChip = (chip: string) => {
    if (!draft) return;
    const el = msgRef.current; const at = el?.selectionStart ?? draft.message.length;
    setDraft({ ...draft, message: draft.message.slice(0, at) + chip + draft.message.slice(at) });
  };

  return (
    <>
      <div className="sheet__list">
        {form.labRules.length === 0 && <div className="muted">{t('alerts.empty')}</div>}
        {form.labRules.map((r, i) => (
          <button key={i} type="button" className="sheet__row" onClick={() => open(i)}>
            <i className={`rule-dot rule-dot--${r.severity === 'RED' ? 'red' : 'yellow'}`} aria-label={t(`severity.${r.severity}`)} />
            <span className="settings-row__text">
              <span>{name(r.key)} {condition(r)}</span>
              <span className="settings-row__sub">{t(`severity.${r.severity}`)} · {preview(r.message, t('alerts.norm'))}</span>
            </span>
            <Icon name="chevron" size={20} style={{ color: 'var(--border-2)' }} />
          </button>
        ))}
      </div>
      <div><button type="button" className="btn btn--soft btn--sm" onClick={() => open(-1)}><Icon name="plus" size={18} />{t('alerts.add')}</button></div>
      <div className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>{t('alerts.hint')}</div>

      {err && <div className="msg msg--error">{err}</div>}
      {msg && <div className="msg msg--ok">{msg}</div>}
      <div className="settings-savebar">
        <button type="button" className="btn btn--primary" onClick={() => save(t('alerts.saved'))} disabled={busy || !dirty}>{t('save')}</button>
        {dirty && <button type="button" className="btn btn--ghost" onClick={reset} disabled={busy}>{t('cancelChanges')}</button>}
      </div>

      <BottomSheet open={draft !== null} onClose={close} title={edit != null && edit >= 0 ? t('alerts.titleEdit') : t('alerts.titleNew')}>
        {draft && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <label className="field"><span>{t('alerts.marker')}</span>
              <select value={draft.key} onChange={(e) => setDraft({ ...draft, key: e.target.value })} style={{ height: 36 }}>
                {!keys.includes(draft.key) && <option value={draft.key}>{draft.key}</option>}
                {keys.map((k) => <option key={k} value={k}>{name(k)}</option>)}
              </select>
            </label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <label className="field" style={{ flex: '1 1 140px' }}><span>{t('alerts.condition')}</span>
                <select value={draft.op} onChange={(e) => setDraft({ ...draft, op: e.target.value as LabRule['op'] })} style={{ height: 36 }}>
                  {OPS.map((o) => <option key={o} value={o}>{t(`op.${o}`)}</option>)}
                </select>
              </label>
              <label className="field" style={{ flex: '1 1 100px' }}><span>{draft.op.endsWith('Ref') || !catalogByKey.get(draft.key)?.unit ? t('alerts.value') : t('alerts.valueUnit', { unit: catalogByKey.get(draft.key)!.unit! })}</span>
                <input inputMode="decimal" defaultValue={String(draft.value).replace('.', f.decimal)} key={`${edit}-${draft.key}`} onChange={(e) => { const v = Number(e.target.value.replace(',', '.')); if (Number.isFinite(v)) setDraft({ ...draft, value: v }); }} />
              </label>
              <label className="field" style={{ flex: '1 1 120px' }}><span>{t('alerts.severityLabel')}</span>
                <select value={draft.severity} onChange={(e) => setDraft({ ...draft, severity: e.target.value as LabRule['severity'] })} style={{ height: 36 }}>
                  <option value="RED">{t('severity.RED')}</option>
                  <option value="YELLOW">{t('severity.YELLOW')}</option>
                </select>
              </label>
            </div>
            <label className="field"><span>{t('alerts.message')}</span>
              <input ref={msgRef} value={draft.message} onChange={(e) => setDraft({ ...draft, message: e.target.value })} maxLength={300} />
            </label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <span className="muted" style={{ fontSize: 13 }}>{t('alerts.insert')}</span>
              {CHIPS.map(([chip, label]) => <button key={chip} type="button" className="btn btn--ghost btn--sm" onClick={() => insertChip(chip)}>{t(`alerts.chips.${label}`)}</button>)}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn--primary" onClick={commit}>{t('done')}</button>
              {edit != null && edit >= 0 && <button type="button" className="btn btn--ghost" onClick={remove}>{t('alerts.remove')}</button>}
            </div>
            <div className="muted" style={{ fontSize: 12 }}>{t('alerts.applyHint')}</div>
          </div>
        )}
      </BottomSheet>
    </>
  );
}
