'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'use-intl';
import Icon from '../ui/icons';
import BottomSheet from '../ui/BottomSheet';
import AiContext from '../ui/AiContext';
import { apiFetch } from '../ui/labUtils';
import { todayKey } from '../ui/api';
import { errorRu } from '../ui/api';
import { useFormat } from '../ui/format';
import type { Contact } from '../ui/contacts';
import EmptyState from '../ui/EmptyState';
import { takeFiles } from '../ui/FileButton';

type Appt = {
  id: string; date: string; time: string | null; doctor: string | null; place: string | null; notes: string | null;
  status: 'planned' | 'done' | 'cancelled'; questions: string | null; questionsContext: string | null; questionsModel: string | null; questionsAt: string | null;
  reportMilestoneId: string | null;
};
type Resp = { appointments: Appt[]; next: Appt | null; overdue: Appt[]; today: string };
type Form = { date: string; time: string; doctor: string; place: string; notes: string };

const daysBetween = (a: string, b: string) => Math.round((new Date(a + 'T12:00:00Z').getTime() - new Date(b + 'T12:00:00Z').getTime()) / 86400000);
const emptyForm = (): Form => ({ date: todayKey(), time: '', doctor: '', place: '', notes: '' });

export default function ConsultsPage() {
  const t = useTranslations('consults');
  const f = useFormat();
  const fmtDate = (d: string) => f.date(d, { day: 'numeric', month: 'long', year: 'numeric' });
  const [data, setData] = useState<Resp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<Appt | 'new' | null>(null);
  const [form, setForm] = useState<Form>(emptyForm());
  const [reportFor, setReportFor] = useState<Appt | null>(null);
  const [summary, setSummary] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [aiEnabled, setAiEnabled] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const [r, s] = await Promise.all([apiFetch('/api/gateway/appointments'), apiFetch('/api/gateway/ai/status')]);
      if (!r.ok) throw new Error(await r.text());
      setData(await r.json());
      if (s.ok) setAiEnabled(Boolean((await s.json()).enabled));
    } catch (e: any) { setErr(String(e?.message || e)); }
  }, []);
  useEffect(() => { load(); }, [load]);
  // contacts: names to pick for the doctor field, and a call button on an appointment whose doctor is in the list
  const [contacts, setContacts] = useState<Contact[]>([]);
  useEffect(() => { apiFetch('/api/gateway/contacts').then(async (r) => { if (r.ok) setContacts((await r.json()).contacts || []); }); }, []);
  const contactOf = (name: string | null) => (name ? contacts.find((c) => c.name.trim().toLowerCase() === name.trim().toLowerCase()) : undefined);

  function openNew() { setForm(emptyForm()); setEditing('new'); }
  function openEdit(a: Appt) { setForm({ date: a.date, time: a.time || '', doctor: a.doctor || '', place: a.place || '', notes: a.notes || '' }); setEditing(a); }
  async function save() {
    if (!form.date) { setErr(t('needDate')); return; }
    setBusy('save'); setErr(null);
    try {
      const body = JSON.stringify({ date: form.date, time: form.time || null, doctor: form.doctor || null, place: form.place || null, notes: form.notes || null });
      const r = editing === 'new'
        ? await apiFetch('/api/gateway/appointments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
        : await apiFetch(`/api/gateway/appointments/${(editing as Appt).id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body });
      if (!r.ok) throw new Error(await r.text());
      setEditing(null); await load();
    } catch (e: any) { setErr(String(e?.message || e)); } finally { setBusy(null); }
  }
  async function remove(a: Appt) {
    if (!window.confirm(t('confirmDelete', { date: fmtDate(a.date) }))) return;
    const r = await apiFetch(`/api/gateway/appointments/${a.id}`, { method: 'DELETE' });
    if (r.ok) { setEditing(null); load(); } else setErr(await r.text());
  }
  async function setStatus(a: Appt, status: Appt['status']) {
    setBusy(a.id);
    try {
      const r = await apiFetch(`/api/gateway/appointments/${a.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
      if (!r.ok) throw new Error(await r.text());
      await load();
    } catch (e: any) { setErr(String(e?.message || e)); } finally { setBusy(null); }
  }
  async function questions(a: Appt) {
    setBusy(`q:${a.id}`); setErr(null);
    try {
      const r = await apiFetch(`/api/gateway/appointments/${a.id}/questions`, { method: 'POST' });
      const j = await r.json();
      if (!r.ok) throw new Error(errorRu(j));
      await load();
    } catch (e: any) { setErr(t('failed', { error: String(e?.message || e) })); } finally { setBusy(null); }
  }
  async function sendReport() {
    if (!reportFor) return;
    setBusy('report'); setErr(null);
    try {
      const fd = new FormData();
      fd.set('summary', summary);
      for (const f of files) fd.append('file', f);
      const r = await apiFetch(`/api/gateway/appointments/${reportFor.id}/report`, { method: 'POST', body: fd });
      if (!r.ok) throw new Error(await r.text());
      setReportFor(null); setSummary(''); setFiles([]);
      await load();
    } catch (e: any) { setErr(String(e?.message || e)); } finally { setBusy(null); }
  }

  const today = data?.today || todayKey();
  const planned = (data?.appointments || []).filter((a) => a.status === 'planned').sort((a, b) => a.date.localeCompare(b.date));
  const past = (data?.appointments || []).filter((a) => a.status !== 'planned');

  function card(a: Appt) {
    const d = daysBetween(a.date, today);
    const when = a.status !== 'planned' ? (a.status === 'done' ? t('card.whenDone') : t('card.whenCancelled')) : d === 0 ? t('card.whenToday') : d === 1 ? t('card.whenTomorrow') : d > 0 ? t('card.whenIn', { n: d }) : t('card.whenOverdue', { n: -d });
    return (
      <div key={a.id} className={`card meds-card ${a.status === 'planned' && d < 0 ? 'appt--overdue' : ''}`}>
        <div className="ms-card__head">
          <div className="event-card__icon event-card__icon--other"><Icon name="consult" size={22} /></div>
          <div className="event-card__body">
            <div className="ms-card__date">{fmtDate(a.date)}{a.time ? ` · ${f.clock(a.time)}` : ''} · {when}</div>
            <div className="ms-card__title">{a.doctor || t('card.defaultDoctor')}{a.place ? ` · ${a.place}` : ''}</div>
            {(() => { const c = contactOf(a.doctor); return c ? <div className="contact-card__links" style={{ marginTop: 4 }}>{c.phones.slice(0, 1).map((p) => <a key={p} href={`tel:${p.split(/доб|#|,/i)[0].replace(/[^\d+]/g, '')}`} className="btn btn--soft btn--sm">{p}</a>)}<a href={`/contacts#${c.id}`} className="btn btn--ghost btn--sm">{t('card.contact')}</a></div> : null; })()}
          </div>
          <span className={`pill ${a.status === 'done' ? 'ok' : a.status === 'planned' && d < 0 ? 'pill--danger' : ''}`}>{a.status === 'done' ? t('card.statusDone') : a.status === 'cancelled' ? t('card.statusCancelled') : d < 0 ? t('card.statusOverdue') : t('card.statusPlanned')}</span>
        </div>
        {a.notes && <div className="ms-card__notes">{a.notes}</div>}
        {a.questions && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="section-label">{t('card.questions')}{a.questionsAt ? ` · ${f.date(a.questionsAt, { day: 'numeric', month: 'short' })}` : ''}{a.questionsModel ? ` · ${a.questionsModel}` : ''}</div>
            <div className="ai-comment__text">{a.questions}</div>
            <AiContext context={a.questionsContext} />
          </div>
        )}
        <div className="ms-card__files">
          {a.status === 'planned' && (
            <button type="button" className={`btn btn--sm ${a.questions ? 'btn--secondary' : 'btn--primary'}`} onClick={() => questions(a)} disabled={!!busy || !aiEnabled} title={aiEnabled ? '' : t('card.noAiKey')}>
              <Icon name="refresh" size={18} />{busy === `q:${a.id}` ? t('card.collecting') : a.questions ? t('card.updateQuestions') : t('card.prepareQuestions')}
            </button>
          )}
          {a.status === 'planned' && <button type="button" className="btn btn--secondary btn--sm" onClick={() => { setReportFor(a); setSummary(''); setFiles([]); }} disabled={!!busy}><Icon name="upload" size={18} />{t('card.uploadReport')}</button>}
          {a.status === 'planned' && d <= 0 && <button type="button" className="btn btn--ghost btn--sm" onClick={() => setStatus(a, 'done')} disabled={!!busy}>{t('card.doneWithoutReport')}</button>}
          {a.status === 'done' && a.reportMilestoneId && <Link href="/history" className="btn btn--ghost btn--sm"><Icon name="doc" size={18} />{t('card.reportInHistory')}</Link>}
          {a.status === 'done' && !a.reportMilestoneId && <button type="button" className="btn btn--ghost btn--sm" onClick={() => { setReportFor(a); setSummary(''); setFiles([]); }} disabled={!!busy}><Icon name="upload" size={18} />{t('card.addReport')}</button>}
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => openEdit(a)}>{t('card.edit')}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-header__title">{t('title')}</h1>
        <p className="page-header__desc">{t('desc')}</p>
      </div>
      {err && <div className="msg msg--error" style={{ marginBottom: 16 }}>{err}</div>}
      <button type="button" className="btn btn--primary" onClick={openNew} style={{ marginBottom: 20 }}><Icon name="plus" />{t('add')}</button>

      {data === null && !err && <div className="skeleton" style={{ height: 120 }} />}
      {data && planned.length === 0 && (
        <EmptyState icon="consult" title={t('emptyTitle')} description={t('emptyDesc')} />
      )}
      <div className="today-section">{planned.map(card)}</div>
      {past.length > 0 && <><div className="section-label" style={{ marginTop: 20 }}>{t('past')}</div><div className="today-section">{past.map(card)}</div></>}

      <BottomSheet open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? t('sheet.newTitle') : t('sheet.title')}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <label className="field"><span>{t('sheet.date')}</span><input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label>
          <label className="field"><span>{t('sheet.time')}</span><input type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} /></label>
        </div>
        <label className="field"><span>{t('sheet.doctor')}</span><input list="contacts-names" value={form.doctor} onChange={(e) => setForm({ ...form, doctor: e.target.value })} placeholder={t('sheet.doctorPlaceholder')} /></label>
        <datalist id="contacts-names">{contacts.map((c) => <option key={c.id} value={c.name}>{c.role || ''}</option>)}</datalist>
        <label className="field"><span>{t('sheet.place')}</span><input value={form.place} onChange={(e) => setForm({ ...form, place: e.target.value })} placeholder={t('sheet.placePlaceholder')} /></label>
        <label className="field"><span>{t('sheet.notes')}</span><textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder={t('sheet.notesPlaceholder')} /></label>
        <button type="button" className="btn btn--primary btn--lg btn--block" onClick={save} disabled={busy === 'save'}><Icon name="check" strokeWidth={2.2} />{t('sheet.save')}</button>
        {editing !== 'new' && editing && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {editing.status !== 'cancelled' && <button type="button" className="btn btn--ghost" onClick={() => { setStatus(editing, 'cancelled'); setEditing(null); }}>{t('sheet.cancelAppt')}</button>}
            {editing.status !== 'planned' && <button type="button" className="btn btn--ghost" onClick={() => { setStatus(editing, 'planned'); setEditing(null); }}>{t('sheet.backToPlanned')}</button>}
            <button type="button" className="btn btn--ghost" onClick={() => remove(editing)}>{t('sheet.delete')}</button>
          </div>
        )}
      </BottomSheet>

      <BottomSheet open={reportFor !== null} onClose={() => setReportFor(null)} title={t('report.title')}>
        <div className="muted" style={{ fontSize: 14, lineHeight: 1.5 }}>{t('report.hint', { date: reportFor ? fmtDate(reportFor.date) : '' })}</div>
        <label className="field"><span>{t('report.files')}</span>
          <input ref={fileRef} type="file" accept="application/pdf,image/*" multiple onChange={(e) => { takeFiles(e.target, setFiles); }} />
          {files.length > 0 && <span className="muted" style={{ fontSize: 13 }}>{files.map((f) => f.name).join(', ')}</span>}
        </label>
        <label className="field"><span>{t('report.summary')}</span><textarea rows={4} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder={t('report.summaryPlaceholder')} /></label>
        <button type="button" className="btn btn--primary btn--lg btn--block" onClick={sendReport} disabled={busy === 'report' || (!files.length && !summary.trim())}><Icon name="check" strokeWidth={2.2} />{busy === 'report' ? t('report.saving') : t('report.save')}</button>
      </BottomSheet>
    </div>
  );
}
