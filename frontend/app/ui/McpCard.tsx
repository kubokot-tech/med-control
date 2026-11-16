'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'use-intl';
import { apiJson, errorRu } from './api';
import { useFormat } from './format';

type Token = { id: string; name: string; scope: 'read' | 'write'; createdAt: string; lastUsedAt: string | null; revokedAt: string | null };
type AuditRow = { at: string; method: string; tool: string | null; ok: boolean; detail: string | null; token: string | null };
type State = { enabled: boolean; disabledByAdmin: boolean; endpoint: string; tokens: Token[]; audit: AuditRow[] };

/** MCP methods with a name in `mcpCard.method`. */
const METHOD: Record<string, 'initialize' | 'toolsList' | 'toolsCall'> = { initialize: 'initialize', 'tools/list': 'toolsList', 'tools/call': 'toolsCall' };

/** Settings → AI agents access (MCP): off by default, a warning to switch on, tokens per agent, the audit log. */
export default function McpCard() {
  const t = useTranslations('settings');
  const f = useFormat();
  const [s, setS] = useState<State | null>(null);
  const [ack, setAck] = useState(false);
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'read' | 'write'>('read');
  const [fresh, setFresh] = useState<{ token: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // the password is asked again for anything that outlives the session (switching on, a new token)
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => { apiJson<State>('/api/gateway/settings/mcp').then(setS).catch((e) => setErr(errorRu(e))); }, []);
  useEffect(load, [load]);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true); setErr(null);
    try { await fn(); load(); } catch (e) { setErr(errorRu(e)); } finally { setBusy(false); }
  }
  const put = (body: object) => apiJson('/api/gateway/settings/mcp', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const when = (d: string | null) => (d ? f.date(d, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
  const config = (token: string) => JSON.stringify({ mcpServers: { medcontrol: { type: 'http', url: s?.endpoint, headers: { Authorization: `Bearer ${token}` } } } }, null, 2);

  if (!s) return <div className="card meds-card"><div className="muted">{t('mcpCard.loading')}</div>{err && <div className="msg msg--error">{err}</div>}</div>;
  const active = s.tokens.filter((tk) => !tk.revokedAt);

  if (s.disabledByAdmin) {
    return <div className="card meds-card"><div className="card__title">{t('mcpCard.blockedTitle')}</div><div className="muted" style={{ fontSize: 14 }}>{t.rich('mcpCard.blockedText', { code: (c) => <code>{c}</code> })}</div></div>;
  }

  if (!s.enabled) {
    return (
      <div className="card meds-card">
        <div className="meds-card__row"><div className="card__title">{t('mcpCard.offTitle')}</div><span className="pill">{t('mcpCard.offPill')}</span></div>
        <div className="msg msg--warning" style={{ lineHeight: 1.5 }}>
          <b>{t('mcpCard.readFirst')}</b>
          <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
            <li>{t('mcpCard.warnData')}</li>
            <li>{t('mcpCard.warnCloud')}</li>
            <li>{t('mcpCard.warnToken')}</li>
            <li>{t('mcpCard.warnAudit')}</li>
          </ul>
        </div>
        <label className="choice-row"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /><span>{t('mcpCard.ack')}</span></label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t('mcpCard.passwordPlaceholder')} autoComplete="current-password" style={{ width: 170 }} aria-label={t('mcpCard.passwordLabel')} />
          <button type="button" className="btn btn--primary btn--sm" disabled={!ack || !password || busy} onClick={() => act(async () => { await put({ enabled: true, acknowledged: true, password }); setPassword(''); })}>{t('mcpCard.enable')}</button>
        </div>
        {err && <div className="msg msg--error">{err}</div>}
      </div>
    );
  }

  return (
    <>
      <div className="card meds-card">
        <div className="meds-card__row"><div className="card__title">{t('mcpCard.onTitle')}</div><span className="pill pill--warning">{t('mcpCard.onPill')}</span></div>
        <div className="field"><span>{t('mcpCard.endpoint')}</span><input readOnly value={s.endpoint} onFocus={(e) => e.target.select()} /></div>
        <div className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>{t.rich('mcpCard.howTo', { code: (c) => <code>{c}</code> })}</div>
        <div><button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => { if (confirm(t('mcpCard.disableConfirm'))) act(() => put({ enabled: false })); }}>{t('mcpCard.disable')}</button></div>
      </div>

      <div className="card meds-card">
        <div className="card__title">{t('mcpCard.tokens', { n: active.length })}</div>
        {fresh && (
          <div className="msg msg--ok" style={{ display: 'flex', flexDirection: 'column', gap: 6, wordBreak: 'break-all' }}>
            <div>{t.rich('mcpCard.freshToken', { name: fresh.name, token: fresh.token, code: (c) => <code>{c}</code> })}</div>
            <div style={{ fontSize: 13 }}>{t('mcpCard.configHint')}</div>
            <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, margin: 0 }}>{config(fresh.token)}</pre>
            <div><button type="button" className="btn btn--ghost btn--sm" onClick={() => setFresh(null)}>{t('mcpCard.copied')}</button></div>
          </div>
        )}
        {s.tokens.length > 0 && (
          <div className="sheet__list">
            {s.tokens.map((tk) => (
              <div key={tk.id} className="list-row">
                <span>
                  <b>{tk.name}</b> <span className="muted" style={{ fontSize: 13 }}>· {t(`mcpCard.scope.${tk.scope}`)}</span>
                  <br /><span className="muted" style={{ fontSize: 13 }}>{tk.revokedAt ? t('mcpCard.revoked', { date: when(tk.revokedAt) }) : t('mcpCard.created', { date: when(tk.createdAt), last: when(tk.lastUsedAt) })}</span>
                </span>
                {!tk.revokedAt && <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => { if (confirm(t('mcpCard.revokeConfirm', { name: tk.name }))) act(() => apiJson(`/api/gateway/settings/mcp/tokens/${tk.id}`, { method: 'DELETE' })); }}>{t('mcpCard.revoke')}</button>}
              </div>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label className="field" style={{ flex: '1 1 200px' }}><span>{t('mcpCard.agentName')}</span><input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder={t('mcpCard.agentNamePlaceholder')} /></label>
          <label className="field" style={{ flex: '0 1 200px' }}><span>{t('mcpCard.rights')}</span>
            <select value={scope} onChange={(e) => setScope(e.target.value as 'read' | 'write')} style={{ height: 36 }}>
              <option value="read">{t('mcpCard.scope.read')}</option>
              <option value="write">{t('mcpCard.scope.write')}</option>
            </select>
          </label>
          <label className="field" style={{ flex: '0 1 170px' }}><span>{t('mcpCard.yourPassword')}</span><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></label>
          <button type="button" className="btn btn--primary btn--sm" disabled={busy || !name.trim() || !password} onClick={() => act(async () => {
            const j = await apiJson<{ token: string; info: Token }>('/api/gateway/settings/mcp/tokens', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim(), scope, password }) });
            setFresh({ token: j.token, name: j.info.name }); setName(''); setPassword('');
          })}>{t('mcpCard.createToken')}</button>
        </div>
        {err && <div className="msg msg--error">{err}</div>}
      </div>

      <div className="card meds-card">
        <div className="card__title">{t('mcpCard.audit')}</div>
        {s.audit.length === 0 ? <div className="muted">{t('mcpCard.auditEmpty')}</div> : (
          <div className="sheet__list" style={{ fontSize: 14 }}>
            {s.audit.map((a, i) => (
              <div key={i} className="list-row">
                <span>{a.ok ? '' : '⚠ '}{a.tool || (METHOD[a.method] ? t(`mcpCard.method.${METHOD[a.method]}`) : a.method)}<br /><span className="muted" style={{ fontSize: 12 }}>{when(a.at)} · {a.token || t('mcpCard.tokenDeleted')}{a.ok ? '' : ` · ${t('mcpCard.refusal', { detail: a.detail || t('mcpCard.error') })}`}</span></span>
              </div>
            ))}
          </div>
        )}
        <div className="muted" style={{ fontSize: 12 }}>{t('mcpCard.auditHint')}</div>
      </div>
    </>
  );
}
