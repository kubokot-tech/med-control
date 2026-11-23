'use client';

import { useState, useRef, useCallback, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'use-intl';
import LabsReviewPanel, { type Draft } from '../../ui/LabsReviewPanel';
import ManualLabEntry from '../../ui/ManualLabEntry';
import { apiFetch } from '../../ui/labUtils';
import { errorRu } from '../../ui/api';
import { LabParserRows, useLabParsers } from '../../ui/LabsParsersCard';
import LabSampleInvite from '../../ui/LabSampleInvite';
import FileButton, { rememberFiles } from '../../ui/FileButton';

type FileStatus = 'pending' | 'uploading' | 'done' | 'error' | 'duplicate' | 'review';

type Obs = {
  test_name_raw: string;
  result_text?: string | null;
  result_num?: number | null;
  unit_raw?: string | null;
  ref_text_raw?: string | null;
  ref_low?: number | null;
  ref_high?: number | null;
};

type FileEntry = {
  id: string;
  file: File | { name: string; size: number };
  draft?: Draft;
  status: FileStatus;
  step?: string;
  error?: string;
  labName?: string;
  docDate?: string;
  sha256?: string;
  inserted?: number;
  observations?: Obs[];
  expanded?: boolean;
};

function UploadInner() {
  const t = useTranslations('labs');
  const parsers = useLabParsers();
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [uploading, setUploading] = useState(false);
  const dragCounter = useRef(0);
  const [dragOver, setDragOver] = useState(false);

  const [fileError, setFileError] = useState<string | null>(null);

  const sp = useSearchParams();
  useEffect(() => {
    const sha = sp.get('pending');
    if (!sha) return;
    apiFetch(`/api/gateway/labs/pending/${sha}`)
      .then(async (r) => {
        if (!r.ok) return;
        const j = await r.json();
        setFiles((prev) => prev.some((f) => f.sha256 === j.sha256) ? prev : [{ id: `pending-${j.sha256}`, file: { name: j.filename || t('upload.fromTelegram'), size: 0 }, status: 'review' as FileStatus, sha256: j.sha256, draft: j.draft }, ...prev]);
      })
      .catch(() => {});
  }, [sp, t]);

  const addFiles = useCallback((newFiles: FileList | File[]) => {
    const all = Array.from(newFiles);
    const pdfs = all.filter((f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
    const rejected = all.length - pdfs.length;
    if (rejected > 0) {
      setFileError(t('upload.rejected', { n: rejected }));
      setTimeout(() => setFileError(null), 4000);
    } else {
      setFileError(null);
    }
    const entries: FileEntry[] = pdfs.map((f) => ({
      id: `${f.name}-${f.size}-${f.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
      file: f,
      status: 'pending' as FileStatus,
    }));
    if (entries.length) {
      setFiles((prev) => [...prev, ...entries]);
    }
  }, [t]);

  useEffect(() => {
    const onStep = (e: Event) => {
      const step = (e as CustomEvent<string>).detail;
      if (!step) return;
      setFiles((prev) => prev.map((f) => (f.status === 'uploading' ? { ...f, step } : f)));
    };
    window.addEventListener('mc-step', onStep);
    return () => window.removeEventListener('mc-step', onStep);
  }, []);

  const removeFile = useCallback((id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const toggleExpand = useCallback((id: string) => {
    setFiles((prev) =>
      prev.map((f) => (f.id === id ? { ...f, expanded: !f.expanded } : f))
    );
  }, []);

  const uploadAll = async () => {
    const pending = files.filter((f) => f.status === 'pending');
    if (!pending.length) return;
    setUploading(true);

    for (const entry of pending) {
      setFiles((prev) =>
        prev.map((f) => (f.id === entry.id ? { ...f, status: 'uploading' } : f))
      );

      try {
        const fd = new FormData();
        fd.append('file', entry.file as File);
        const r = await apiFetch('/api/gateway/labs/commit-pdf', { method: 'POST', body: fd });

        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(errorRu(j, `HTTP ${r.status}`));
        }

        const j = await r.json();
        if (j.needsReview) {
          setFiles((prev) => prev.map((f) => (f.id === entry.id ? { ...f, status: 'review', sha256: j.sha256, draft: j.draft } : f)));
          continue;
        }
        setFiles((prev) =>
          prev.map((f) =>
            f.id === entry.id
              ? {
                  ...f,
                  status: j.already ? 'duplicate' : 'done',
                  sha256: j.sha256,
                  inserted: j.inserted,
                  labName: j.labName || j.lab_name,
                  docDate: j.docDate || j.doc_date,
                }
              : f
          )
        );
      } catch (e: any) {
        const raw = String(e?.message || e);
        const error = raw === 'file_unread' ? t('upload.readFailed') : raw;
        setFiles((prev) =>
          prev.map((f) =>
            f.id === entry.id
              ? { ...f, status: 'error', error }
              : f
          )
        );
      }
    }

    setUploading(false);
  };

  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current++;
    setDragOver(true);
  };
  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current === 0) setDragOver(false);
  };
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setDragOver(false);
    if (e.dataTransfer.files.length) {
      void rememberFiles(Array.from(e.dataTransfer.files)).then(addFiles, () => {
        setFileError(t('upload.readFailed'));
        setTimeout(() => setFileError(null), 4000);
      });
    }
  };

  const pendingCount = files.filter((f) => f.status === 'pending').length;
  const doneCount = files.filter((f) => f.status === 'done').length;
  const dupCount = files.filter((f) => f.status === 'duplicate').length;
  const errCount = files.filter((f) => f.status === 'error').length;

  const statusIcon = (s: FileStatus) => {
    switch (s) {
      case 'pending': return '◻️';
      case 'uploading': return '⏳';
      case 'done': return '✅';
      case 'duplicate': return '🔁';
      case 'error': return '❌';
      case 'review': return '🤖';
    }
  };

  const statusLabel = (entry: FileEntry) => {
    switch (entry.status) {
      case 'pending': return t('upload.status.pending');
      case 'uploading':
        if (entry.step === 'reading') return t('upload.status.reading');
        if (entry.step === 'parsing') return t('upload.status.parsing');
        if (entry.step === 'multipart') return t('upload.status.multipart');
        if (entry.step === 'pdf') return t('upload.status.pdf');
        if (entry.step === 'save') return t('upload.status.save');
        return t('upload.status.uploading');
      case 'done': return t('upload.status.done');
      case 'duplicate': return t('upload.status.duplicate');
      case 'error': return t('upload.status.error');
      case 'review': return t('upload.status.review');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <p className="muted" style={{ margin: 0 }}>{t('upload.intro')}</p>

      {fileError && (
        <div style={{ color: 'var(--lo-fg)', background: 'var(--lo-bg)', padding: '8px 14px', borderRadius: 8, fontSize: 13, marginBottom: 12 }}>
          {fileError}
        </div>
      )}

      {/* Drop zone */}
      <FileButton
        accept="application/pdf"
        multiple
        onFiles={addFiles}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDragOver={onDragOver}
        onDrop={onDrop}
        style={{
          display: 'block',
          fontWeight: 400,
          border: `2px dashed ${dragOver ? 'var(--accent)' : 'var(--border-2)'}`,
          borderRadius: 12,
          padding: '40px 24px',
          textAlign: 'center',
          cursor: 'pointer',
          background: dragOver ? 'var(--accent-soft)' : 'var(--surface)',
          transition: 'all 0.2s',
          marginBottom: 20,
        }}
      >
        <div style={{ fontSize: 36, marginBottom: 8 }}>📄</div>
        <div style={{ fontSize: 15, color: 'var(--fg-2)' }}>
          {dragOver ? t('upload.drop') : t('upload.dropHint')}
        </div>
        <div style={{ fontSize: 13, color: 'var(--fg-3)', marginTop: 4 }}>
          {t('upload.parsers')}
        </div>
      </FileButton>

      {files.length === 0 && parsers?.available && parsers.parsers.length > 0 && (
        <details className="card parsers-details">
          <summary>{t('upload.parsersTitle', { n: parsers.parsers.length })}</summary>
          <LabParserRows parsers={parsers.parsers} />
        </details>
      )}

      {files.length === 0 && parsers && <LabSampleInvite send={!!parsers.samples?.send} />}

      {files.length === 0 && <ManualLabEntry />}

      {/* Action bar */}
      {files.length > 0 && (
        <div
          style={{
            display: 'flex',
            gap: 12,
            alignItems: 'center',
            flexWrap: 'wrap',
            marginBottom: 16,
          }}
        >
          <button
            disabled={!pendingCount || uploading}
            onClick={uploadAll}
            className="btn btn--primary"
            style={{ padding: '8px 20px', fontSize: 14 }}
          >
            {uploading
              ? t('upload.progress', { done: doneCount + dupCount + errCount, total: files.length })
              : t('upload.uploadN', { n: pendingCount })}
          </button>

          {!uploading && (
            <button
              onClick={() => setFiles([])}
              style={{
                padding: '8px 16px',
                fontSize: 14,
                background: 'none',
                border: '1px solid var(--border-2)',
                borderRadius: 8,
                cursor: 'pointer',
                color: 'var(--fg-2)',
              }}
            >
              {t('upload.clear')}
            </button>
          )}

          <div style={{ fontSize: 13, color: 'var(--fg-3)', marginLeft: 'auto' }}>
            {doneCount > 0 && <span style={{ color: 'var(--accent)' }}>✓ {doneCount}</span>}
            {dupCount > 0 && <span style={{ marginLeft: 8, color: 'var(--warn)' }}>🔁 {dupCount}</span>}
            {errCount > 0 && <span style={{ marginLeft: 8, color: 'var(--danger)' }}>✗ {errCount}</span>}
          </div>
        </div>
      )}

      {/* File list */}
      {files.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {files.map((entry) => (
            <div
              key={entry.id}
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 10,
                padding: '12px 16px',
                transition: 'all 0.2s',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 18 }}>{statusIcon(entry.status)}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 500,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {entry.file.name}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 2 }}>
                    {t('upload.sizeKb', { size: (entry.file.size / 1024).toFixed(0) })}
                    {entry.status === 'done' && entry.inserted != null && (
                      <span> · {t('upload.inserted', { n: entry.inserted })}</span>
                    )}
                    {entry.sha256 && <span> · {entry.sha256.slice(0, 10)}…</span>}
                    {entry.status !== 'done' && entry.status !== 'duplicate' && (
                      <span> · {statusLabel(entry)}</span>
                    )}
                    {entry.status === 'duplicate' && (
                      <span style={{ color: 'var(--warn)' }}> · {t('upload.already')}</span>
                    )}
                  </div>
                </div>

                {entry.status === 'error' && (
                  <button
                    onClick={() =>
                      setFiles((prev) =>
                        prev.map((f) => (f.id === entry.id ? { ...f, status: 'pending', error: undefined } : f))
                      )
                    }
                    style={{
                      padding: '4px 10px',
                      fontSize: 12,
                      background: 'none',
                      border: '1px solid var(--danger-bd)',
                      borderRadius: 6,
                      color: 'var(--danger)',
                      cursor: 'pointer',
                    }}
                  >
                    {t('upload.retry')}
                  </button>
                )}

                {entry.status === 'uploading' && (
                  <div
                    style={{
                      width: 20,
                      height: 20,
                      border: '2px solid var(--border)',
                      borderTop: '2px solid var(--accent)',
                      borderRadius: '50%',
                      animation: 'spin 0.8s linear infinite',
                    }}
                  />
                )}

                {(entry.status === 'pending' || entry.status === 'error') && !uploading && (
                  <button
                    onClick={() => removeFile(entry.id)}
                    style={{
                      padding: '4px 8px',
                      fontSize: 12,
                      background: 'none',
                      border: 'none',
                      color: 'var(--fg-3)',
                      cursor: 'pointer',
                    }}
                  >
                    ✕
                  </button>
                )}
              </div>

              {entry.status === 'error' && entry.error && (
                <div
                  style={{
                    marginTop: 8,
                    padding: '8px 12px',
                    background: 'var(--danger-bg)',
                    borderRadius: 6,
                    fontSize: 12,
                    color: 'var(--danger)',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                  }}
                >
                  {entry.error}
                </div>
              )}

              {(entry.status === 'review' || entry.status === 'error') && entry.file instanceof File && (
                <div style={{ marginTop: 8 }}><LabSampleInvite file={entry.file} send={!!parsers?.samples?.send} /></div>
              )}

              {entry.status === 'review' && entry.draft && entry.sha256 && (
                <div style={{ marginTop: 10 }}>
                  <LabsReviewPanel
                    sha256={entry.sha256}
                    draft={entry.draft}
                    onSaved={(r) => setFiles((prev) => prev.map((f) => (f.id === entry.id ? { ...f, status: 'done', inserted: r.inserted, labName: r.labName || undefined, docDate: r.docDate || undefined, draft: undefined } : f)))}
                    onDiscard={() => removeFile(entry.id)}
                  />
                </div>
              )}

              {entry.status === 'done' && entry.observations && entry.observations.length > 0 && (
                <>
                  <button
                    onClick={() => toggleExpand(entry.id)}
                    style={{
                      marginTop: 8,
                      fontSize: 12,
                      background: 'none',
                      border: 'none',
                      color: 'var(--accent)',
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  >
                    {entry.expanded ? t('upload.hideResults') : t('upload.showResults')}
                  </button>
                  {entry.expanded && (
                    <div style={{ overflowX: 'auto', marginTop: 8 }}>
                      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
                        <thead>
                          <tr>
                            {(['test', 'value', 'unit', 'ref'] as const).map((h) => (
                              <th
                                key={h}
                                style={{
                                  textAlign: 'left',
                                  borderBottom: '1px solid var(--border)',
                                  padding: '6px 8px',
                                  fontWeight: 500,
                                  color: 'var(--fg-2)',
                                }}
                              >
                                {t(`upload.table.${h}`)}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {entry.observations.map((o, i) => (
                            <tr key={i}>
                              <td style={{ borderBottom: '1px solid var(--surface-2)', padding: '6px 8px' }}>{o.test_name_raw}</td>
                              <td style={{ borderBottom: '1px solid var(--surface-2)', padding: '6px 8px' }}>
                                {o.result_text ?? (o.result_num ?? '—')}
                              </td>
                              <td style={{ borderBottom: '1px solid var(--surface-2)', padding: '6px 8px' }}>{o.unit_raw || '—'}</td>
                              <td style={{ borderBottom: '1px solid var(--surface-2)', padding: '6px 8px' }}>{o.ref_text_raw || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      )}

      <style jsx>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

function Loading() {
  const t = useTranslations('labs');
  return <div style={{ padding: 16 }}>{t('loading')}</div>;
}

export default function UploadPage() {
  return <Suspense fallback={<Loading />}><UploadInner /></Suspense>;
}
