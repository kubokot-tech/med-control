'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'use-intl';
import Icon from '../ui/icons';
import BottomSheet from '../ui/BottomSheet';
import EmptyState from '../ui/EmptyState';
import { apiJson, errorRu } from '../ui/api';
import type { Contact } from '../ui/contacts';

type Form = { name: string; role: string; clinic: string; phones: string; email: string; address: string; url: string; notes: string; pinned: boolean };
const EMPTY: Form = { name: '', role: '', clinic: '', phones: '', email: '', address: '', url: '', notes: '', pinned: false };
const toForm = (c: Contact): Form => ({ name: c.name, role: c.role || '', clinic: c.clinic || '', phones: c.phones.join(', '), email: c.email || '', address: c.address || '', url: c.url || '', notes: c.notes || '', pinned: c.pinned });
/** "+7 (495) 123-45-67" with an extension after it → tel:+74951234567 (the extension is dialled by hand). */
const telHref = (p: string) => `tel:${p.split(/доб|ext|#|,/i)[0].replace(/[^\d+]/g, '')}`;

/** More → Doctors and contacts: who treats, where, how to reach them; phone and e-mail open in one tap. */
export default function ContactsPage() {
  const t = useTranslations('contacts');
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [edit, setEdit] = useState<Contact | 'new' | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const load = useCallback(() => { apiJson<{ contacts: Contact[] }>('/api/gateway/contacts').then((j) => setContacts(j.contacts)).catch((e) => setLoadErr(errorRu(e))); }, []);
  useEffect(load, [load]);

  const open = (c: Contact | 'new') => { setEdit(c); setForm(c === 'new' ? EMPTY : toForm(c)); setErr(null); };
  const close = () => setEdit(null);

  async function save() {
    setBusy(true); setErr(null);
    try {
      const body = JSON.stringify({ ...form, phones: form.phones.split(/[;\n]|,\s*(?=[+\d])/).map((p) => p.trim()).filter(Boolean) });
      if (edit === 'new') await apiJson('/api/gateway/contacts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      else if (edit) await apiJson(`/api/gateway/contacts/${edit.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body });
      close(); load();
    } catch (e) { setErr(errorRu(e)); } finally { setBusy(false); }
  }
  async function remove() {
    if (!edit || edit === 'new' || !confirm(t('confirmDelete', { name: edit.name }))) return;
    setBusy(true);
    try { await apiJson(`/api/gateway/contacts/${edit.id}`, { method: 'DELETE' }); close(); load(); } catch (e) { setErr(errorRu(e)); } finally { setBusy(false); }
  }

  const field = (k: keyof Form, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="field"><span>{label}</span><input value={String(form[k])} onChange={(e) => setForm({ ...form, [k]: e.target.value })} {...props} /></label>
  );

  return (
    <div className="page-container">
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ marginRight: 'auto' }}>
          <h1 className="page-header__title">{t('title')}</h1>
          <p className="page-header__desc">{t('desc')}</p>
        </div>
        <button type="button" className="btn btn--primary btn--sm" onClick={() => open('new')}><Icon name="plus" size={18} />{t('add')}</button>
      </div>
      {loadErr && <div className="msg msg--error">{loadErr}</div>}
      {contacts?.length === 0 && <EmptyState icon="user" title={t('emptyTitle')} description={t('emptyDesc')} />}
      <div className="grid grid--2">
        {contacts?.map((c) => (
          <div key={c.id} id={c.id} className="card meds-card contact-card">
            <div className="meds-card__row">
              <div style={{ minWidth: 0 }}>
                <div className="card__title">{c.pinned && <span title={t('pinnedTitle')}>★ </span>}{c.name}</div>
                {(c.role || c.clinic) && <div className="muted" style={{ fontSize: 14 }}>{[c.role, c.clinic].filter(Boolean).join(' · ')}</div>}
              </div>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => open(c)}>{t('edit')}</button>
            </div>
            {c.phones.length > 0 && <div className="contact-card__links">{c.phones.map((p) => <a key={p} href={telHref(p)} className="btn btn--soft btn--sm">{p}</a>)}</div>}
            {c.email && <a href={`mailto:${c.email}`} className="contact-card__line">{c.email}</a>}
            {c.address && <div className="contact-card__line">{c.address}</div>}
            {c.url && <a href={c.url} target="_blank" rel="noopener noreferrer" className="contact-card__line">{c.url.replace(/^https?:\/\//, '')}</a>}
            {c.notes && <div className="muted" style={{ fontSize: 14, whiteSpace: 'pre-wrap' }}>{c.notes}</div>}
          </div>
        ))}
      </div>

      <BottomSheet open={edit !== null} onClose={close} title={edit === 'new' ? t('sheet.newTitle') : t('sheet.title')}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {field('name', t('sheet.name'), { placeholder: t('sheet.namePlaceholder'), maxLength: 120 })}
          {field('role', t('sheet.role'), { placeholder: t('sheet.rolePlaceholder'), maxLength: 120 })}
          {field('clinic', t('sheet.clinic'), { placeholder: t('sheet.clinicPlaceholder'), maxLength: 200 })}
          {field('phones', t('sheet.phones'), { placeholder: t('sheet.phonesPlaceholder'), inputMode: 'tel' })}
          {field('email', t('sheet.email'), { type: 'email', maxLength: 200 })}
          {field('address', t('sheet.address'), { maxLength: 300 })}
          {field('url', t('sheet.url'), { placeholder: 'https://…', inputMode: 'url', maxLength: 500 })}
          <label className="field"><span>{t('sheet.notes')}</span><textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} maxLength={2000} placeholder={t('sheet.notesPlaceholder')} /></label>
          <label className="choice-row"><input type="checkbox" checked={form.pinned} onChange={(e) => setForm({ ...form, pinned: e.target.checked })} /><span>{t('sheet.pin')}</span></label>
          {err && <div className="msg msg--error">{err}</div>}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn--primary" onClick={save} disabled={busy || !form.name.trim()}>{t('sheet.save')}</button>
            {edit && edit !== 'new' && <button type="button" className="btn btn--ghost" onClick={remove} disabled={busy}>{t('sheet.delete')}</button>}
          </div>
        </div>
      </BottomSheet>
    </div>
  );
}
