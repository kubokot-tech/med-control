'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'use-intl';
import Icon from '../ui/icons';
import BottomSheet from '../ui/BottomSheet';
import LabChart from '../ui/LabChart';
import { apiFetch, openAttachment } from '../ui/labUtils';
import BatchUploadSheet from '../ui/BatchUploadSheet';
import AiComment from '../ui/AiComment';
import SliceSheet from '../ui/SliceSheet';
import { todayKey } from '../ui/api';
import { errorRu } from '../ui/api';
import { useFormat } from '../ui/format';
import { useEdition } from '../ui/edition';
import EmptyState from '../ui/EmptyState';
import { useMedLabels } from '../ui/medLabels';
import FileButton, { takeFiles } from '../ui/FileButton';
import { MODALITIES, MODALITY_CT } from '../../../shared/medCodes.js';

type Attachment = { sha256: string; filename: string | null; mimeType: string | null };
type Study = {
  id: string; milestoneId: string | null; date: string; modality: string; region: string | null; impression: string | null;
  response: string | null; dicomPath: string | null; attachments: Attachment[];
  measurements: Record<string, { sizeMm: number | null; note: string | null }>;
  orthancStudyId?: string | null; studyInstanceUid?: string | null;
};
type Lesion = { id: string; name: string; location: string | null; isTarget: boolean; retired: boolean };
type Recist = { group?: string; studyId: string; date: string; sum: number; lesionCount: number; baseline: number; nadir: number; changeFromBaselinePct: number; changeFromNadirPct: number; response: string };
type Data = { studies: Study[]; lesions: Lesion[]; recist: Recist[]; aiEnabled: boolean; aiModel?: string; orthancEnabled?: boolean };
type Folder = { folder: string; import: { files: number; imported: number; studies: { date: string | null; modality: string; linked: string }[]; finished_at: string | null; error: string | null } | null };
type Job = { folder: string; status: string; files: number; imported: number; error: string | null };
type Report = { modality: string; region: string; date: string | null; impression: string; response: string; lesions: { name: string; location: string | null; sizeMm: number | null; prevSizeMm: number | null; note: string | null }[]; newLesions: boolean; warnings: string[] };

// response codes; labels: imaging.page.response.<code>
const RESP = ['NA', 'SD', 'PR', 'PD', 'CR'] as const;
const respPill = (r: string | null) => (r === 'PR' || r === 'CR' ? 'ok' : r === 'PD' ? 'pill--danger' : r === 'SD' ? 'pill--info' : '');
const num = (s: string) => (s.trim() === '' ? null : parseFloat(s.replace(',', '.')));

export default function ImagingPage() {
  const t = useTranslations('imaging.page');
  const label = useMedLabels();
  const ed = useEdition();
  const f = useFormat();
  const fmtDate = (k: string) => f.date(k, { day: 'numeric', month: 'long', year: 'numeric' });
  const fmtShort = (k: string) => f.date(k, { day: 'numeric', month: 'short', year: '2-digit' });
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [studyEdit, setStudyEdit] = useState<Study | 'new' | null>(null);
  const [form, setForm] = useState({ date: '', modality: MODALITY_CT, region: t('defaultRegion'), impression: '', response: 'NA', dicomPath: '' });
  const [measureFor, setMeasureFor] = useState<Study | null>(null);
  const [sizes, setSizes] = useState<Record<string, string>>({});
  const [newLesion, setNewLesion] = useState({ name: '', location: '' });
  const [parseFor, setParseFor] = useState<Study | null>(null);
  const [parseText, setParseText] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  const [reportMap, setReportMap] = useState<Record<number, string>>({}); // report lesion idx -> lesion id | 'new' | 'skip'
  const [batchFiles, setBatchFiles] = useState<File[] | null>(null);
  const [pending, setPending] = useState<File[]>([]);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [sliceFor, setSliceFor] = useState<Study | null>(null);
  const [archive, setArchive] = useState<{ enabled: boolean; up?: boolean; version?: string | null; folders: Folder[]; jobs: Job[] } | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const r = await apiFetch('/api/gateway/imaging');
      if (!r.ok) throw new Error(await r.text());
      setData(await r.json());
    } catch (e: any) {
      setErr(String(e?.message || e));
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  // the Orthanc viewer opens only with a short cookie from a signed-in session (gateway lib/viewerSession.js): ask while here
  useEffect(() => {
    const viewer = () => { apiFetch('/api/gateway/imaging/viewer-session', { method: 'POST' }).catch(() => {}); };
    viewer();
    const t = setInterval(viewer, 60 * 60_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => { if (data && window.location.hash) document.getElementById(window.location.hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, [data]);

  const lesions = data?.lesions.filter((l) => !l.retired) || [];
  const studiesAsc = useMemo(() => (data?.studies || []).slice().sort((a, b) => a.date.localeCompare(b.date)), [data]);
  const recistByStudy = useMemo(() => new Map((data?.recist || []).map((r) => [r.studyId, r])), [data]);
  const recistRows = data?.recist || [];
  const lungRows = recistRows.filter((r) => r.group === MODALITY_CT);
  const chartPoints = (lungRows.length ? lungRows : recistRows).map((r) => ({ date: r.date + 'T12:00:00Z', valueNum: r.sum, valueText: String(r.sum), unit: t('unitMm'), refLow: null, refHigh: null, delta: null }));

  const loadArchive = useCallback(async () => {
    const r = await apiFetch('/api/gateway/imaging/orthanc');
    if (r.ok) setArchive(await r.json());
  }, []);
  useEffect(() => { if (archiveOpen) loadArchive(); }, [archiveOpen, loadArchive]);
  useEffect(() => {
    if (!archiveOpen || !archive?.jobs.some((j) => j.status === 'running')) return;
    const t = setInterval(() => { loadArchive(); load(); }, 3000);
    return () => clearInterval(t);
  }, [archiveOpen, archive, loadArchive, load]);
  async function importFolder(folder: string) {
    setErr(null);
    const r = await apiFetch('/api/gateway/imaging/orthanc/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folder }) });
    if (!r.ok) { const j = await r.json().catch(() => ({})); setErr(errorRu(j, t('importFailed'))); }
    await loadArchive();
  }

  // --- study form ---
  function openNewStudy() {
    setPending([]);
    setForm({ date: todayKey(), modality: MODALITY_CT, region: t('defaultRegion'), impression: '', response: 'NA', dicomPath: '' });
    setStudyEdit('new');
  }
  function openEditStudy(s: Study) {
    setPending([]);
    setForm({ date: s.date, modality: s.modality, region: s.region || '', impression: s.impression || '', response: s.response || 'NA', dicomPath: s.dicomPath || '' });
    setStudyEdit(s);
  }
  async function saveStudy() {
    if (!form.date || !form.modality) { setErr(t('needDateModality')); return; }
    setBusy(true); setErr(null);
    try {
      const body = JSON.stringify({ date: form.date, modality: form.modality, region: form.region || null, impression: form.impression || null, response: form.response === 'NA' ? null : form.response, dicomPath: form.dicomPath || null });
      const r = studyEdit === 'new'
        ? await apiFetch('/api/gateway/imaging/studies', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
        : await apiFetch(`/api/gateway/imaging/studies/${(studyEdit as Study).id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body });
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      const milestoneId: string | null = j.study?.milestoneId ?? (studyEdit !== 'new' ? (studyEdit as Study).milestoneId : null);
      for (const f of pending) {
        if (!milestoneId) break;
        const fd = new FormData();
        fd.set('file', f, f.name);
        const up = await apiFetch(`/api/gateway/milestones/${milestoneId}/attachments`, { method: 'POST', body: fd });
        if (!up.ok) throw new Error(t('fileError', { name: f.name, error: await up.text() }));
      }
      setPending([]);
      setStudyEdit(null);
      await load();
    } catch (e: any) { setErr(String(e?.message || e)); } finally { setBusy(false); }
  }
  async function removeFile(s: Study, a: Attachment) {
    if (!s.milestoneId) return;
    const r = await apiFetch(`/api/gateway/milestones/${s.milestoneId}/attachments/${a.sha256}`, { method: 'DELETE' });
    if (r.ok) load(); else setErr(await r.text());
  }
  async function deleteStudy(s: Study) {
    if (!window.confirm(t('confirmDelete', { modality: label.modality(s.modality), date: fmtDate(s.date) }))) return;
    const r = await apiFetch(`/api/gateway/imaging/studies/${s.id}`, { method: 'DELETE' });
    if (r.ok) { setStudyEdit(null); load(); } else setErr(await r.text());
  }

  // --- files ---
  async function attach(id: string, files: File[]) {
    if (!files.length) return;
    setBusy(true); setErr(null);
    try {
      for (const f of files) {
        const fd = new FormData(); fd.set('file', f, f.name);
        const r = await apiFetch(`/api/gateway/milestones/${id}/attachments`, { method: 'POST', body: fd });
        if (!r.ok) throw new Error(await r.text());
      }
      await load();
    } catch (e: any) { setErr(String(e?.message || e)); } finally { setBusy(false); }
  }
  async function openFile(a: Attachment) {
    const out = await openAttachment(a);
    if (!out.ok) setErr(await out.response.text());
  }

  // --- measurements ---
  function openMeasure(s: Study) {
    const init: Record<string, string> = {};
    for (const l of lesions) init[l.id] = s.measurements[l.id]?.sizeMm != null ? String(s.measurements[l.id].sizeMm) : '';
    setSizes(init); setNewLesion({ name: '', location: '' }); setMeasureFor(s);
  }
  async function addLesion(): Promise<Lesion | null> {
    if (!newLesion.name.trim()) return null;
    const r = await apiFetch('/api/gateway/imaging/lesions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newLesion.name.trim(), location: newLesion.location || null, isTarget: true }) });
    if (!r.ok) { setErr(await r.text()); return null; }
    const l = (await r.json()).lesion as Lesion;
    setNewLesion({ name: '', location: '' });
    await load();
    return l;
  }
  async function saveMeasurements() {
    if (!measureFor) return;
    setBusy(true); setErr(null);
    try {
      const measurements = Object.entries(sizes).map(([lesionId, v]) => ({ lesionId, sizeMm: num(v) }));
      const r = await apiFetch(`/api/gateway/imaging/studies/${measureFor.id}/measurements`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ measurements }) });
      if (!r.ok) throw new Error(await r.text());
      setMeasureFor(null);
      await load();
    } catch (e: any) { setErr(String(e?.message || e)); } finally { setBusy(false); }
  }
  async function toggleTarget(l: Lesion) {
    await apiFetch(`/api/gateway/imaging/lesions/${l.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isTarget: !l.isTarget }) });
    load();
  }

  // --- AI parse ---
  function openParse(s: Study) { setParseFor(s); setReport(null); setParseText(''); setReportMap({}); }
  async function runParse() {
    if (!parseFor) return;
    setBusy(true); setErr(null);
    try {
      const r = await apiFetch(`/api/gateway/imaging/studies/${parseFor.id}/parse`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: parseText }) });
      const j = await r.json();
      if (!r.ok) throw new Error(errorRu(j));
      const rep = j.report as Report;
      setReport(rep);
      const map: Record<number, string> = {};
      rep.lesions.forEach((rl, i) => {
        const match = lesions.find((l) => l.name.toLowerCase() === rl.name.toLowerCase());
        map[i] = match ? match.id : 'new';
      });
      setReportMap(map);
    } catch (e: any) { setErr(String(e?.message || e)); } finally { setBusy(false); }
  }
  async function applyReport() {
    if (!parseFor || !report) return;
    setBusy(true); setErr(null);
    try {
      const patch: any = { impression: report.impression, response: report.response === 'NA' ? null : report.response };
      if (report.date) patch.date = report.date;
      if (report.modality) patch.modality = report.modality;
      if (report.region) patch.region = report.region;
      let r = await apiFetch(`/api/gateway/imaging/studies/${parseFor.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
      if (!r.ok) throw new Error(await r.text());
      const measurements: { lesionId: string; sizeMm: number | null }[] = [];
      for (let i = 0; i < report.lesions.length; i++) {
        const rl = report.lesions[i];
        const choice = reportMap[i];
        if (choice === 'skip' || rl.sizeMm == null) continue;
        let lesionId = choice;
        if (choice === 'new') {
          const cr = await apiFetch('/api/gateway/imaging/lesions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: rl.name, location: rl.location, isTarget: true }) });
          if (!cr.ok) throw new Error(await cr.text());
          lesionId = (await cr.json()).lesion.id;
        }
        measurements.push({ lesionId, sizeMm: rl.sizeMm });
      }
      if (measurements.length) {
        r = await apiFetch(`/api/gateway/imaging/studies/${parseFor.id}/measurements`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ measurements }) });
        if (!r.ok) throw new Error(await r.text());
      }
      setParseFor(null); setReport(null);
      await load();
    } catch (e: any) { setErr(String(e?.message || e)); } finally { setBusy(false); }
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-header__title">{t('title')}</h1>
        <p className="page-header__desc">{t('desc')}</p>
      </div>
      {err && <div className="msg msg--error" style={{ marginBottom: 16 }}>{err}</div>}

      <div className="row" style={{ marginBottom: 20 }}>
        <button type="button" className="btn btn--primary" onClick={openNewStudy}><Icon name="plus" />{t('addStudy')}</button>
        <FileButton className="btn btn--secondary" accept="application/pdf,image/*" multiple onFiles={setBatchFiles}><Icon name="upload" />{t('uploadReports')}</FileButton>
        {data?.orthancEnabled && <button type="button" className="btn btn--secondary" onClick={() => setArchiveOpen(true)}><Icon name="imaging" />{t('archive')}</button>}
        {!ed.available('dicom') && <button type="button" className="btn btn--secondary" disabled title={t('serverOnlyTitle')}><Icon name="imaging" />{t('archiveServerOnly')}</button>}
        <Link href="/history" className="btn btn--ghost">{t('history')}</Link>
        <BatchUploadSheet files={batchFiles} defaultKind="imaging" onClose={() => setBatchFiles(null)} onDone={load} />
      </div>

      {data && data.recist.length > 1 && (
        <div className="card meds-card" style={{ marginBottom: 20 }}>
          <div className="meds-card__row">
            <div className="card__title">{t('recist.title')}</div>
            {(() => { const last = (lungRows.length ? lungRows : recistRows)[(lungRows.length ? lungRows : recistRows).length - 1]; return <span className={`pill ${respPill(last.response)}`}>{label.response(last.response)}{last.response !== 'baseline' ? ` · ${t('recist.fromBaseline', { pct: `${last.changeFromBaselinePct > 0 ? '+' : ''}${last.changeFromBaselinePct}` })}` : ''}</span>; })()}
          </div>
          <LabChart points={chartPoints} unit={t('unitMm')} showTrend={false} />
          <div className="muted" style={{ fontSize: 14 }}>{t('recist.note')}</div>
        </div>
      )}

      {data && lesions.length > 0 && studiesAsc.length > 0 && (
        <div className="pivot" style={{ marginBottom: 20 }}>
          <table>
            <thead><tr><th>{t('pivot.lesionHeader')}</th>{studiesAsc.map((s) => <th key={s.id}>{fmtShort(s.date)}<br /><span className="muted" style={{ fontWeight: 500 }}>{label.modality(s.modality)}</span></th>)}</tr></thead>
            <tbody>
              {lesions.map((l) => (
                <tr key={l.id}>
                  <td>
                    <div className="pivot__name">
                      <button type="button" className="pivot__name-btn" onClick={() => toggleTarget(l)} title={l.isTarget ? t('pivot.targetTitle') : t('pivot.nonTargetTitle')}>{l.name}</button>
                      <div className="pivot__code">{l.location || ''}{l.isTarget ? '' : ` · ${t('pivot.notInSum')}`}</div>
                    </div>
                  </td>
                  {studiesAsc.map((s) => {
                    const cur = s.measurements[l.id]?.sizeMm ?? null;
                    const prevStudy = studiesAsc.slice(0, studiesAsc.indexOf(s)).reverse().find((p) => p.measurements[l.id]?.sizeMm != null);
                    const prev = prevStudy?.measurements[l.id]?.sizeMm ?? null;
                    const cls = cur != null && prev != null ? (cur < prev ? 'pivot__cell--ok' : cur > prev ? 'pivot__cell--high' : '') : '';
                    return <td key={s.id}><span className={`pivot__cell ${cls}`}>{cur != null ? cur : '—'}</span></td>;
                  })}
                </tr>
              ))}
              {data.recist.length > 0 && (
                <tr>
                  <td><div className="pivot__name"><span className="pivot__name-plain">{t('pivot.sum')}</span><div className="pivot__code">{t('pivot.targetLesions')}</div></div></td>
                  {studiesAsc.map((s) => { const r = recistByStudy.get(s.id); return <td key={s.id}>{r ? <span className={`pill ${respPill(r.response)}`}>{r.sum} · {r.response === 'baseline' ? t('pivot.baseline') : r.response}</span> : <span className="muted">—</span>}</td>; })}
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {data === null && !err && <div className="skeleton" style={{ height: 120 }} />}
      {data?.studies.length === 0 && (
        <EmptyState icon="imaging" title={t('emptyTitle')} description={t('emptyDesc')} />
      )}

      <div className="today-section">
        {data?.studies.map((s) => {
          const r = recistByStudy.get(s.id);
          return (
            <div key={s.id} id={s.id} className="card meds-card" style={{ scrollMarginTop: 16 }}>
              <div className="ms-card__head">
                <div className="event-card__icon event-card__icon--other"><Icon name="imaging" size={22} /></div>
                <div className="event-card__body">
                  <div className="ms-card__date">{fmtDate(s.date)}</div>
                  <div className="ms-card__title">{label.modality(s.modality)}{s.region ? ` · ${s.region}` : ''}</div>
                </div>
                {s.response && <span className={`pill ${respPill(s.response)}`}>{label.response(s.response)}</span>}
              </div>
              {s.impression && <div className="ms-card__notes">{s.impression}</div>}
              {r && <div className="muted" style={{ fontSize: 14 }}>{r.response !== 'baseline'
                ? t('card.sumChange', { sum: r.sum, pct: `${r.changeFromBaselinePct > 0 ? '+' : ''}${r.changeFromBaselinePct}`, label: label.response(r.response) })
                : t('card.sumBaseline', { sum: r.sum })}</div>}
              <div className="ms-card__files">
                {s.attachments.map((a) => (
                  <span key={a.sha256} className="ms-file">
                    <button type="button" className="ms-file__open" onClick={() => openFile(a)}><Icon name={a.mimeType?.startsWith('image/') ? 'imaging' : 'doc'} size={18} />{a.filename || a.sha256.slice(0, 10)}</button>
                    <button type="button" className="ms-file__x" aria-label={t('card.removeFile')} onClick={() => removeFile(s, a)}><Icon name="close" size={16} /></button>
                  </span>
                ))}
                {ed.available('dicom') && s.orthancStudyId && s.studyInstanceUid && <a className="btn btn--soft btn--sm" href={`/orthanc/stone-webviewer/index.html?study=${encodeURIComponent(s.studyInstanceUid)}`} target="_blank" rel="noreferrer"><Icon name="imaging" size={18} />{t('card.openViewer')}</a>}
                {ed.available('dicom') && s.orthancStudyId && <button type="button" className="btn btn--ghost btn--sm" onClick={() => setSliceFor(s)}><Icon name="plus" size={18} />{t('card.saveSlice')}</button>}
                {s.milestoneId && <FileButton className="btn btn--ghost btn--sm" accept="application/pdf,image/*" multiple disabled={busy} onFiles={(files) => attach(s.milestoneId!, files)}><Icon name="upload" size={18} />{t('card.report')}</FileButton>}
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => openMeasure(s)}>{t('card.measurements')}</button>
                <button type="button" className="btn btn--soft btn--sm" onClick={() => openParse(s)} disabled={!data?.aiEnabled} title={data?.aiEnabled ? t('card.modelTitle', { model: data.aiModel || '' }) : t('card.needAiKey')}>{t('card.parse')}</button>
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => openEditStudy(s)}>{t('card.edit')}</button>
              </div>
              <AiComment subjectType="imaging_study" subjectId={s.id} compact />
            </div>
          );
        })}
      </div>

      <BottomSheet open={archiveOpen} onClose={() => setArchiveOpen(false)} title={t('archiveSheet.title')}>
        <div className="muted" style={{ fontSize: 14, lineHeight: 1.5 }}>
          {t.rich('archiveSheet.desc', { code: (c) => <code>{c}</code>, hasVersion: archive?.version ? 'yes' : 'no', version: archive?.version || '' })}
        </div>
        {archive && !archive.up && <div className="msg msg--error">{t('archiveSheet.down')}</div>}
        {archive?.folders.length === 0 && <div className="muted">{t('archiveSheet.noFolders')}</div>}
        <div className="sheet__list">
          {archive?.folders.map((f) => {
            const job = archive.jobs.find((j) => j.folder === f.folder);
            const running = job?.status === 'running';
            const done = f.import?.finished_at && !f.import.error;
            return (
              <div key={f.folder} className="list-row">
                <span style={{ minWidth: 0 }}>
                  <b>{f.folder}</b>
                  <br /><span className="muted" style={{ fontSize: 13 }}>
                    {running ? t('archiveSheet.running', { imported: job!.imported, files: job!.files })
                      : f.import?.error ? t('archiveSheet.error', { error: f.import.error })
                        : done ? t('archiveSheet.done', { imported: f.import!.imported, studies: f.import!.studies.map((x) => `${label.modality(x.modality)} ${x.date || ''}`).join(', ') || t('archiveSheet.noStudies') })
                          : t('archiveSheet.notImported')}
                  </span>
                </span>
                <button type="button" className={`btn btn--sm ${done ? 'btn--ghost' : 'btn--primary'}`} disabled={running || archive.jobs.some((j) => j.status === 'running') || !archive.up} onClick={() => importFolder(f.folder)}>{done ? t('archiveSheet.reimport') : t('archiveSheet.import')}</button>
              </div>
            );
          })}
        </div>
        {archive?.enabled && <a className="btn btn--ghost" href="/orthanc/app/explorer.html" target="_blank" rel="noreferrer">{t('archiveSheet.openOrthanc')}</a>}
      </BottomSheet>

      {sliceFor && <SliceSheet open={sliceFor !== null} onClose={() => setSliceFor(null)} studyId={sliceFor.id} title={`${label.modality(sliceFor.modality)} ${fmtDate(sliceFor.date)}`} onSaved={load} />}

      {/* Study sheet */}
      <BottomSheet open={studyEdit !== null} onClose={() => setStudyEdit(null)} title={studyEdit === 'new' ? t('studySheet.newTitle') : t('studySheet.title')}>
        <div className="sheet__block"><div className="section-label">{t('studySheet.modality')}</div>
          <div className="seg" style={{ flexWrap: 'wrap' }}>{MODALITIES.map((m) => <button key={m} type="button" className={`seg__btn ${form.modality === m ? 'seg__btn--active' : ''}`} onClick={() => setForm({ ...form, modality: m })}>{label.modality(m)}</button>)}</div></div>
        <label className="field"><span>{t('studySheet.date')}</span><input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label>
        <label className="field"><span>{t('studySheet.region')}</span><input value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} placeholder={t('studySheet.regionPlaceholder')} /></label>
        <div className="sheet__block"><div className="section-label">{t('studySheet.response')}</div>
          <div className="seg" style={{ flexWrap: 'wrap' }}>{RESP.map((k) => <button key={k} type="button" className={`seg__btn ${form.response === k ? `seg__btn--active ${k === 'PD' ? 'seg__btn--warn' : ''}` : ''}`} onClick={() => setForm({ ...form, response: k })}>{t(`response.${k}`)}</button>)}</div></div>
        <label className="field"><span>{t('studySheet.impression')}</span><textarea rows={4} value={form.impression} onChange={(e) => setForm({ ...form, impression: e.target.value })} placeholder={t('studySheet.impressionPlaceholder')} /></label>
        <label className="field"><span>{t('studySheet.dicomPath')}</span><input value={form.dicomPath} onChange={(e) => setForm({ ...form, dicomPath: e.target.value })} placeholder={t('studySheet.dicomPathPlaceholder')} /></label>
        <label className="field"><span>{t('studySheet.files')}</span>
          <input type="file" accept="application/pdf,image/*" multiple onChange={(e) => { takeFiles(e.target, setPending); }} />
          {pending.length > 0 && <span className="muted" style={{ fontSize: 13 }}>{pending.map((f) => f.name).join(', ')}</span>}
        </label>
        <button type="button" className="btn btn--primary btn--lg btn--block" onClick={saveStudy} disabled={busy}><Icon name="check" strokeWidth={2.2} />{t('studySheet.save')}</button>
        {studyEdit !== 'new' && studyEdit && <button type="button" className="btn btn--ghost" onClick={() => deleteStudy(studyEdit as Study)}>{t('studySheet.delete')}</button>}
      </BottomSheet>

      {/* Measurements sheet */}
      <BottomSheet open={measureFor !== null} onClose={() => setMeasureFor(null)} title={measureFor ? t('measureSheet.title', { date: fmtShort(measureFor.date) }) : ''}>
        <div className="muted" style={{ fontSize: 14 }}>{t('measureSheet.hint')}</div>
        {lesions.map((l) => (
          <label key={l.id} className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <span style={{ flexGrow: 1 }}>{l.name}<span className="muted" style={{ fontWeight: 400 }}>{l.location ? ` · ${l.location}` : ''}</span></span>
            <input inputMode="decimal" style={{ width: 110 }} placeholder={t('measureSheet.sizePlaceholder')} value={sizes[l.id] ?? ''} onChange={(e) => setSizes({ ...sizes, [l.id]: e.target.value })} />
          </label>
        ))}
        <div className="sheet__block" style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <div className="section-label">{t('measureSheet.newLesion')}</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input placeholder={t('measureSheet.namePlaceholder')} value={newLesion.name} onChange={(e) => setNewLesion({ ...newLesion, name: e.target.value })} style={{ flex: 1, minWidth: 0 }} />
            <input placeholder={t('measureSheet.locationPlaceholder')} value={newLesion.location} onChange={(e) => setNewLesion({ ...newLesion, location: e.target.value })} style={{ flex: 1, minWidth: 0 }} />
            <button type="button" className="btn btn--secondary" onClick={addLesion}><Icon name="plus" /></button>
          </div>
        </div>
        <button type="button" className="btn btn--primary btn--lg btn--block" onClick={saveMeasurements} disabled={busy}><Icon name="check" strokeWidth={2.2} />{t('measureSheet.save')}</button>
      </BottomSheet>

      {/* AI parse sheet */}
      <BottomSheet open={parseFor !== null} onClose={() => setParseFor(null)} title={t('parseSheet.title')}>
        {!report && (
          <>
            <div className="muted" style={{ fontSize: 14 }}>
              {t('parseSheet.hint', { n: parseFor?.attachments.length || 0 })}
            </div>
            <label className="field"><span>{t('parseSheet.text')}</span><textarea rows={6} value={parseText} onChange={(e) => setParseText(e.target.value)} placeholder={t('parseSheet.textPlaceholder')} /></label>
            <button type="button" className="btn btn--primary btn--lg btn--block" onClick={runParse} disabled={busy}>{busy ? t('parseSheet.reading') : t('parseSheet.parse')}</button>
          </>
        )}
        {report && (
          <>
            <div className="value-card value-card--muted" style={{ alignItems: 'flex-start' }}>
              <div>
                <div className="value-card__title">{label.modality(report.modality)} · {report.region}{report.date ? ` · ${fmtShort(report.date)}` : ''}</div>
                <div className="value-card__sub" style={{ marginTop: 4 }}>{report.impression}</div>
                <div style={{ marginTop: 6 }}><span className={`pill ${respPill(report.response)}`}>{label.response(report.response)}</span>{report.newLesions && <span className="pill pill--danger" style={{ marginLeft: 6 }}>{t('parseSheet.newLesions')}</span>}</div>
              </div>
            </div>
            {report.warnings.length > 0 && <div className="msg msg--warn">{report.warnings.join(' · ')}</div>}
            <div className="sheet__block">
              <div className="section-label">{t('parseSheet.lesions')}</div>
              {report.lesions.map((rl, i) => (
                <div key={i} className="dose-history__row" style={{ alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
                  <span style={{ fontWeight: 600 }}>{rl.name}</span>
                  <span className="muted">{rl.location || ''}</span>
                  <span style={{ fontWeight: 600 }}>{rl.sizeMm != null ? t('parseSheet.sizeMm', { size: rl.sizeMm }) : t('parseSheet.noSize')}{rl.prevSizeMm != null ? ` ${t('parseSheet.prevSize', { prev: rl.prevSizeMm })}` : ''}</span>
                  <select value={reportMap[i] || 'new'} onChange={(e) => setReportMap({ ...reportMap, [i]: e.target.value })} style={{ flexBasis: '100%', minHeight: 44 }}>
                    <option value="new">{t('parseSheet.newLesion', { name: rl.name })}</option>
                    {lesions.map((l) => <option key={l.id} value={l.id}>{t('parseSheet.sameLesion', { name: l.name })}</option>)}
                    <option value="skip">{t('parseSheet.skip')}</option>
                  </select>
                </div>
              ))}
              {report.lesions.length === 0 && <div className="muted">{t('parseSheet.noLesions')}</div>}
            </div>
            <button type="button" className="btn btn--primary btn--lg btn--block" onClick={applyReport} disabled={busy}><Icon name="check" strokeWidth={2.2} />{t('parseSheet.save')}</button>
            <button type="button" className="btn btn--ghost" onClick={() => setReport(null)}>{t('parseSheet.back')}</button>
          </>
        )}
      </BottomSheet>
    </div>
  );
}
