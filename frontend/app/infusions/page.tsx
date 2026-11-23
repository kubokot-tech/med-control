'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'use-intl';
import Icon from '../ui/icons';
import BottomSheet from '../ui/BottomSheet';
import { apiFetch } from '../ui/labUtils';
import AiAsk from '../ui/AiAsk';
import { todayKey, errorRu } from '../ui/api';
import { useFormat } from '../ui/format';
import { useEdition } from '../ui/edition';
import EmptyState from '../ui/EmptyState';
import { useMedLabels } from '../ui/medLabels';
import { ROUTES, ROUTE_IV_DRIP, ROUTE_OTHER, DEFAULT_DOSE_UNIT, isShotRoute } from '../../../shared/medCodes.js';

type Agent = { id: string; name: string; shortName: string | null; defaultDose: number | null; doseUnit: string | null; route: string; notes: string | null; active: boolean; count?: number; lastDate: string | null };
type Course = { id: string; agentId: string; agentName: string; agentShort: string | null; title: string | null; plannedCount: number | null; cadenceDays: number | null; startDate: string; status: 'active' | 'done' | 'cancelled'; remind: boolean; notes: string | null; done: number; lastDate: string | null; nextDue: string | null };
type CForm = { agentId: string; title: string; plannedCount: string; cadenceDays: string; startDate: string; remind: boolean; notes: string };
type Infusion = { id: string; agentId: string; courseId?: string | null; route?: string | null; agentName: string; agentShort: string | null; date: string; time: string | null; doseValue: number | null; doseUnit: string | null; durationMin: number | null; place: string | null; notes: string | null; reaction: string | null };
type IForm = { agentId: string; courseId: string; route: string; date: string; time: string; dose: string; unit: string; durationMin: string; place: string; notes: string; reaction: string };
type AForm = { name: string; shortName: string; defaultDose: string; doseUnit: string; route: string; notes: string };

const today = () => todayKey();
const num = (s: string) => { const v = parseFloat(s.replace(',', '.')); return Number.isFinite(v) ? v : null; };

export default function InfusionsPage() {
  const t = useTranslations('infusions');
  const f = useFormat();
  const ed = useEdition();
  const label = useMedLabels();
  const fmtDate = (d: string) => f.date(d, { day: 'numeric', month: 'long', year: 'numeric' });
  const fmtNum = (n: number) => f.number(n, { maximumFractionDigits: 2 });
  const [agents, setAgents] = useState<Agent[]>([]);
  const [items, setItems] = useState<Infusion[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Infusion | 'new' | null>(null);
  const [form, setForm] = useState<IForm | null>(null);
  const [agentEdit, setAgentEdit] = useState<Agent | 'new' | null>(null);
  const [aform, setAform] = useState<AForm>({ name: '', shortName: '', defaultDose: '', doseUnit: f.unit(DEFAULT_DOSE_UNIT) || '', route: ROUTE_IV_DRIP, notes: '' });
  const [showCatalog, setShowCatalog] = useState(false);
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseEdit, setCourseEdit] = useState<Course | 'new' | null>(null);
  const [cform, setCform] = useState<CForm>({ agentId: '', title: '', plannedCount: '10', cadenceDays: '3', startDate: today(), remind: true, notes: '' });

  const load = useCallback(async () => {
    setErr(null);
    try {
      const r = await apiFetch('/api/gateway/infusions');
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      setAgents(j.agents); setItems(j.infusions); setCourses(j.courses || []);
    } catch (e: any) { setErr(String(e?.message || e)); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const active = agents.filter((a) => a.active);
  const activeCourses = courses.filter((c) => c.status === 'active');
  function openNew(agent?: Agent, course?: Course) {
    const a = agent || active[0];
    const c = course || activeCourses.find((x) => x.agentId === a?.id);
    setForm({ agentId: a?.id || '', courseId: c?.id || '', route: a?.route || ROUTE_IV_DRIP, date: today(), time: '', dose: a?.defaultDose != null ? String(a.defaultDose) : '', unit: f.unit(a?.doseUnit) || '', durationMin: '', place: '', notes: '', reaction: '' });
    setEditing('new');
  }
  function openEdit(x: Infusion) {
    setForm({ agentId: x.agentId, courseId: x.courseId || '', route: x.route || '', date: x.date, time: x.time || '', dose: x.doseValue != null ? String(x.doseValue) : '', unit: f.unit(x.doseUnit) || '', durationMin: x.durationMin != null ? String(x.durationMin) : '', place: x.place || '', notes: x.notes || '', reaction: x.reaction || '' });
    setEditing(x);
  }
  function pickAgent(id: string) {
    const a = agents.find((x) => x.id === id);
    const c = activeCourses.find((x) => x.agentId === id);
    setForm((cur) => cur ? { ...cur, agentId: id, courseId: c?.id || '', route: a?.route || cur.route, dose: a?.defaultDose != null ? String(a.defaultDose) : cur.dose, unit: f.unit(a?.doseUnit) || cur.unit } : cur);
  }
  async function save() {
    if (!form?.agentId || !form.date) { setErr(t('required')); return; }
    setBusy(true); setErr(null);
    try {
      const body = JSON.stringify({ agentId: form.agentId, courseId: form.courseId || null, route: form.route || null, date: form.date, time: form.time || null, doseValue: num(form.dose), doseUnit: form.unit || null, durationMin: form.durationMin ? Number(form.durationMin) : null, place: form.place || null, notes: form.notes || null, reaction: form.reaction || null });
      const r = editing === 'new'
        ? await apiFetch('/api/gateway/infusions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
        : await apiFetch(`/api/gateway/infusions/${(editing as Infusion).id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body });
      if (!r.ok) throw new Error(await r.text());
      setEditing(null); await load();
    } catch (e: any) { setErr(String(e?.message || e)); } finally { setBusy(false); }
  }
  async function remove(x: Infusion) {
    if (!window.confirm(t('confirmRemove', { name: x.agentShort || x.agentName, date: fmtDate(x.date) }))) return;
    const r = await apiFetch(`/api/gateway/infusions/${x.id}`, { method: 'DELETE' });
    if (r.ok) { setEditing(null); load(); } else setErr(await r.text());
  }
  function openAgentNew() { setAform({ name: '', shortName: '', defaultDose: '', doseUnit: f.unit(DEFAULT_DOSE_UNIT) || '', route: ROUTE_IV_DRIP, notes: '' }); setAgentEdit('new'); }
  function openAgentEdit(a: Agent) { setAform({ name: a.name, shortName: a.shortName || '', defaultDose: a.defaultDose != null ? String(a.defaultDose) : '', doseUnit: f.unit(a.doseUnit) || '', route: a.route, notes: a.notes || '' }); setAgentEdit(a); }
  async function saveAgent() {
    if (!aform.name.trim()) { setErr(t('agent.nameRequired')); return; }
    setBusy(true); setErr(null);
    try {
      const body = JSON.stringify({ name: aform.name.trim(), shortName: aform.shortName || null, defaultDose: num(aform.defaultDose), doseUnit: aform.doseUnit || null, route: aform.route || null, notes: aform.notes || null });
      const r = agentEdit === 'new'
        ? await apiFetch('/api/gateway/infusions/agents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
        : await apiFetch(`/api/gateway/infusions/agents/${(agentEdit as Agent).id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body });
      if (!r.ok) throw new Error((await r.json()).message || 'error');
      setAgentEdit(null); await load();
    } catch (e: any) { setErr(String(e?.message || e)); } finally { setBusy(false); }
  }
  async function toggleAgent(a: Agent) {
    const r = await apiFetch(`/api/gateway/infusions/agents/${a.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: !a.active }) });
    if (r.ok) load();
  }
  async function removeAgent(a: Agent) {
    if (!window.confirm(t('agent.confirmRemove', { name: a.name }))) return;
    const r = await apiFetch(`/api/gateway/infusions/agents/${a.id}`, { method: 'DELETE' });
    if (r.ok) { setAgentEdit(null); load(); } else setErr((await r.json()).message || t('agent.removeFailed'));
  }

  function openCourseNew(agent?: Agent) {
    setCform({ agentId: agent?.id || active[0]?.id || '', title: '', plannedCount: '10', cadenceDays: '3', startDate: today(), remind: true, notes: '' });
    setCourseEdit('new');
  }
  function openCourseEdit(c: Course) {
    setCform({ agentId: c.agentId, title: c.title || '', plannedCount: c.plannedCount != null ? String(c.plannedCount) : '', cadenceDays: c.cadenceDays != null ? String(c.cadenceDays) : '', startDate: c.startDate, remind: c.remind, notes: c.notes || '' });
    setCourseEdit(c);
  }
  async function saveCourse(patch?: Partial<{ status: Course['status'] }>, target?: Course) {
    setBusy(true); setErr(null);
    try {
      const body = JSON.stringify(patch || { agentId: cform.agentId, title: cform.title || null, plannedCount: cform.plannedCount ? Number(cform.plannedCount) : null, cadenceDays: cform.cadenceDays ? Number(cform.cadenceDays) : null, startDate: cform.startDate, remind: cform.remind, notes: cform.notes || null });
      const existing = target || (courseEdit !== 'new' ? courseEdit : null);
      const r = existing
        ? await apiFetch(`/api/gateway/infusions/courses/${existing.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body })
        : await apiFetch('/api/gateway/infusions/courses', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      if (!r.ok) throw new Error(errorRu(await r.json().catch(() => ({}))));
      setCourseEdit(null); await load();
    } catch (e: any) { setErr(String(e?.message || e)); } finally { setBusy(false); }
  }
  async function removeCourse(c: Course) {
    if (!confirm(t('course.confirmRemove'))) return;
    const r = await apiFetch(`/api/gateway/infusions/courses/${c.id}`, { method: 'DELETE' });
    if (!r.ok) { setErr(errorRu(await r.json().catch(() => ({})))); return; }
    setCourseEdit(null); await load();
  }
  const courseLabel = (c: Course) => c.title || c.agentShort || c.agentName;
  const progress = (c: Course) => (c.plannedCount ? t('course.progressOf', { done: c.done, planned: c.plannedCount }) : String(c.done));

  const byMonth = new Map<string, Infusion[]>();
  for (const x of items || []) { const k = x.date.slice(0, 7); if (!byMonth.has(k)) byMonth.set(k, []); byMonth.get(k)!.push(x); }
  const monthTitle = (ym: string) => f.date(`${ym}-01`, { month: 'long', year: 'numeric' });

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-header__title">{t('title')}</h1>
        <p className="page-header__desc">{t('desc')}</p>
      </div>
      {err && <div className="msg msg--error" style={{ marginBottom: 16 }}>{err}</div>}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {active.map((a) => (
          <button key={a.id} type="button" className="btn btn--primary" onClick={() => openNew(a)}><Icon name="drip" />{a.shortName || a.name}{a.defaultDose != null ? ` ${fmtNum(a.defaultDose)} ${f.unit(a.doseUnit) || ''}` : ''}</button>
        ))}
        <button type="button" className="btn btn--secondary" onClick={() => setShowCatalog(!showCatalog)}><Icon name="settings" />{t('catalogButton')}</button>
        <button type="button" className="btn btn--secondary" onClick={() => openCourseNew()}><Icon name="plus" size={18} />{t('courseButton')}</button>
      </div>

      {courses.length > 0 && (
        <div className="card meds-card" style={{ marginBottom: 16 }}>
          <div className="card__title">{t('course.list')}</div>
          <div className="sheet__list">
            {courses.filter((c) => c.status === 'active' || c.status === 'done').slice(0, 8).map((c) => (
              <div key={c.id} className="list-row" style={{ opacity: c.status === 'active' ? 1 : 0.6 }}>
                <span style={{ minWidth: 0 }}>
                  <b>{courseLabel(c)}</b> · {progress(c)}{c.cadenceDays ? ` · ${t('course.cadence', { days: c.cadenceDays })}` : ''}
                  <br /><span className="muted" style={{ fontSize: 13 }}>
                    {c.status === 'done' ? (c.lastDate ? t('course.doneOn', { date: fmtDate(c.lastDate) }) : t('course.done')) : c.nextDue ? (c.nextDue <= today() ? (c.nextDue === today() ? t('course.dueToday') : t('course.overdue', { date: fmtDate(c.nextDue) })) : t('course.next', { date: fmtDate(c.nextDue) })) : t('course.since', { date: fmtDate(c.startDate) })}
                    {c.status === 'active' && c.remind && c.cadenceDays ? ` · ${t(ed.available('telegram') ? 'course.remind' : 'course.remindDevice')}` : ''}
                  </span>
                </span>
                <span style={{ display: 'flex', gap: 6 }}>
                  {c.status === 'active' && <button type="button" className="btn btn--primary btn--sm" onClick={() => openNew(agents.find((a) => a.id === c.agentId), c)}>{t('course.record')}</button>}
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => openCourseEdit(c)}>{t('edit')}</button>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {showCatalog && (
        <div className="card meds-card" style={{ marginBottom: 16 }}>
          <div className="meds-card__row"><div className="card__title">{t('catalog.title')}</div><button type="button" className="btn btn--secondary btn--sm" onClick={openAgentNew}><Icon name="plus" size={18} />{t('catalog.add')}</button></div>
          <div className="sheet__list">
            {agents.map((a) => (
              <div key={a.id} className="list-row" style={{ opacity: a.active ? 1 : 0.55 }}>
                <span style={{ minWidth: 0 }}>
                  <b>{a.name}</b>{a.defaultDose != null ? ` · ${fmtNum(a.defaultDose)} ${f.unit(a.doseUnit) || ''}` : ''}{a.route ? ` · ${label.route(a.route)}` : ''}
                  <br /><span className="muted" style={{ fontSize: 13 }}>{a.count ? (a.lastDate ? t('catalog.sessionsLast', { count: a.count, date: fmtDate(a.lastDate) }) : t('catalog.sessions', { count: a.count })) : t('catalog.noSessions')}{a.notes ? ` · ${a.notes}` : ''}</span>
                </span>
                <span style={{ display: 'flex', gap: 6 }}>
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => openAgentEdit(a)}>{t('edit')}</button>
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => toggleAgent(a)}>{a.active ? t('catalog.hide') : t('catalog.restore')}</button>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card meds-card" style={{ marginBottom: 16 }}>
        <div className="card__title">{t('ai.title')}</div>
        <div className="muted" style={{ fontSize: 14, lineHeight: 1.5 }}>{t('ai.desc')}</div>
        <AiAsk subjectType="infusions" subjectId="all" />
      </div>

      {items === null && !err && <div className="skeleton" style={{ height: 120 }} />}
      {items?.length === 0 && (
        <EmptyState icon="drip" title={t('empty.title')} description={t('empty.desc')} />
      )}
      {[...byMonth].map(([ym, list]) => (
        <div key={ym} style={{ marginBottom: 18 }}>
          <div className="section-label">{monthTitle(ym)} · {list.length}</div>
          <div className="today-section">
            {list.map((x) => (
              <div key={x.id} className="card meds-card" style={{ gap: 6 }}>
                <div className="ms-card__head">
                  <div className="event-card__icon event-card__icon--other"><Icon name="drip" size={22} /></div>
                  <div className="event-card__body">
                    <div className="ms-card__date">{fmtDate(x.date)}{x.time ? ` · ${f.clock(x.time)}` : ''}{x.route ? ` · ${label.route(x.route)}` : ''}{x.place ? ` · ${x.place}` : ''}</div>
                    <div className="ms-card__title">{isShotRoute(x.route) ? '💉 ' : ''}{x.agentShort || x.agentName}{x.doseValue != null ? ` ${fmtNum(x.doseValue)} ${f.unit(x.doseUnit) || ''}` : ''}{x.durationMin ? ` · ${t('minutes', { n: x.durationMin })}` : ''}</div>
                  </div>
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => openEdit(x)}>{t('edit')}</button>
                </div>
                {(x.notes || x.reaction) && <div className="ms-card__notes">{[x.notes, x.reaction ? t('reaction', { text: x.reaction }) : null].filter(Boolean).join(' · ')}</div>}
              </div>
            ))}
          </div>
        </div>
      ))}

      <BottomSheet open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? t('record.titleNew') : t('record.title')}>
        {form && (<>
          <label className="field"><span>{t('record.agent')}</span>
            <select value={form.agentId} onChange={(e) => pickAgent(e.target.value)}>{agents.filter((a) => a.active || a.id === form.agentId).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
          </label>
          <label className="field"><span>{t('record.route')}</span>
            <select value={form.route} onChange={(e) => setForm({ ...form, route: e.target.value })}>{[...ROUTES, ...(form.route && !ROUTES.includes(form.route) ? [form.route] : [])].map((r) => <option key={r} value={r}>{label.route(r)}</option>)}</select>
          </label>
          {courses.some((c) => c.agentId === form.agentId) && (
            <label className="field"><span>{t('record.course')}</span>
              <select value={form.courseId} onChange={(e) => setForm({ ...form, courseId: e.target.value })}>
                <option value="">{t('record.noCourse')}</option>
                {courses.filter((c) => c.agentId === form.agentId && (c.status === 'active' || c.id === form.courseId)).map((c) => <option key={c.id} value={c.id}>{courseLabel(c)} · {progress(c)}</option>)}
              </select>
            </label>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <label className="field"><span>{t('record.date')}</span><input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label>
            <label className="field"><span>{t('record.time')}</span><input type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} /></label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            <label className="field"><span>{t('record.dose')}</span><input inputMode="decimal" value={form.dose} onChange={(e) => setForm({ ...form, dose: e.target.value })} /></label>
            <label className="field"><span>{t('record.unit')}</span><input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} /></label>
            <label className="field"><span>{t('record.minutes')}</span><input inputMode="numeric" value={form.durationMin} onChange={(e) => setForm({ ...form, durationMin: e.target.value })} /></label>
          </div>
          <label className="field"><span>{t('record.place')}</span><input value={form.place} onChange={(e) => setForm({ ...form, place: e.target.value })} placeholder={t('record.placePlaceholder')} /></label>
          <label className="field"><span>{t('record.notes')}</span><input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder={t('record.notesPlaceholder')} /></label>
          <label className="field"><span>{t('record.reaction')}</span><input value={form.reaction} onChange={(e) => setForm({ ...form, reaction: e.target.value })} placeholder={t('record.reactionPlaceholder')} /></label>
          <button type="button" className="btn btn--primary btn--lg btn--block" onClick={save} disabled={busy}><Icon name="check" strokeWidth={2.2} />{t('save')}</button>
          {editing !== 'new' && editing && <button type="button" className="btn btn--ghost" onClick={() => remove(editing)}>{t('record.remove')}</button>}
        </>)}
      </BottomSheet>

      <BottomSheet open={agentEdit !== null} onClose={() => setAgentEdit(null)} title={agentEdit === 'new' ? t('agent.titleNew') : t('agent.title')}>
        <label className="field"><span>{t('agent.name')}</span><input value={aform.name} onChange={(e) => setAform({ ...aform, name: e.target.value })} placeholder={t('agent.namePlaceholder')} /></label>
        <label className="field"><span>{t('agent.shortName')}</span><input value={aform.shortName} onChange={(e) => setAform({ ...aform, shortName: e.target.value })} placeholder="IVC" maxLength={40} /></label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.6fr', gap: 8 }}>
          <label className="field"><span>{t('agent.dose')}</span><input inputMode="decimal" value={aform.defaultDose} onChange={(e) => setAform({ ...aform, defaultDose: e.target.value })} /></label>
          <label className="field"><span>{t('agent.unit')}</span><input value={aform.doseUnit} onChange={(e) => setAform({ ...aform, doseUnit: e.target.value })} /></label>
          <label className="field"><span>{t('agent.route')}</span><select value={ROUTES.includes(aform.route) ? aform.route : ROUTE_OTHER} onChange={(e) => setAform({ ...aform, route: e.target.value })}>{ROUTES.map((r) => <option key={r} value={r}>{label.route(r)}</option>)}</select></label>
        </div>
        <label className="field"><span>{t('agent.notes')}</span><textarea rows={3} value={aform.notes} onChange={(e) => setAform({ ...aform, notes: e.target.value })} /></label>
        <button type="button" className="btn btn--primary btn--lg btn--block" onClick={saveAgent} disabled={busy}><Icon name="check" strokeWidth={2.2} />{t('save')}</button>
        {agentEdit !== 'new' && agentEdit && <button type="button" className="btn btn--ghost" onClick={() => removeAgent(agentEdit)}>{t('agent.remove')}</button>}
      </BottomSheet>

      <BottomSheet open={courseEdit !== null} onClose={() => setCourseEdit(null)} title={courseEdit === 'new' ? t('course.titleNew') : t('course.title')}>
        <div className="muted" style={{ fontSize: 14, lineHeight: 1.5 }}>{t(ed.available('telegram') ? 'course.intro' : 'course.introDevice')}</div>
        <label className="field"><span>{t('course.agent')}</span>
          <select value={cform.agentId} onChange={(e) => setCform({ ...cform, agentId: e.target.value })}>{agents.filter((a) => a.active || a.id === cform.agentId).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        </label>
        <label className="field"><span>{t('course.name')}</span><input value={cform.title} onChange={(e) => setCform({ ...cform, title: e.target.value })} placeholder={t('course.namePlaceholder')} maxLength={120} /></label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
          <label className="field"><span>{t('course.planned')}</span><input inputMode="numeric" value={cform.plannedCount} onChange={(e) => setCform({ ...cform, plannedCount: e.target.value })} /></label>
          <label className="field"><span>{t('course.cadenceDays')}</span><input inputMode="numeric" value={cform.cadenceDays} onChange={(e) => setCform({ ...cform, cadenceDays: e.target.value })} /></label>
          <label className="field"><span>{t('course.start')}</span><input type="date" value={cform.startDate} onChange={(e) => setCform({ ...cform, startDate: e.target.value })} /></label>
        </div>
        <label className="list-row" style={{ cursor: 'pointer' }}><span>{t(ed.available('telegram') ? 'course.remindToggle' : 'course.remindToggleDevice')}</span><input type="checkbox" checked={cform.remind} onChange={(e) => setCform({ ...cform, remind: e.target.checked })} /></label>
        <label className="field"><span>{t('course.notes')}</span><input value={cform.notes} onChange={(e) => setCform({ ...cform, notes: e.target.value })} placeholder={t('course.notesPlaceholder')} /></label>
        <button type="button" className="btn btn--primary btn--lg btn--block" onClick={() => saveCourse()} disabled={busy || !cform.agentId || !cform.startDate}><Icon name="check" strokeWidth={2.2} />{t('save')}</button>
        {courseEdit !== 'new' && courseEdit && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {courseEdit.status === 'active' && <button type="button" className="btn btn--secondary btn--sm" onClick={() => saveCourse({ status: 'done' }, courseEdit)} disabled={busy}>{t('course.finish')}</button>}
            {courseEdit.status !== 'active' && <button type="button" className="btn btn--secondary btn--sm" onClick={() => saveCourse({ status: 'active' }, courseEdit)} disabled={busy}>{t('course.reopen')}</button>}
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => removeCourse(courseEdit)} disabled={busy}>{t('course.remove')}</button>
          </div>
        )}
      </BottomSheet>
    </div>
  );
}
