'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'use-intl';
import { apiFetch } from './labUtils';
import { errorRu } from './api';
import { useEdition } from './edition';

type Caps = { pdf: boolean; images: boolean; schema: boolean };
type ProviderInfo = { id: string; label: string; keySet: boolean; caps: Caps; needsFolder: boolean; keyOptional: boolean; keyUrl: string | null; note: string | null; models: { main: string; fast: string } };
type Status = {
  provider: string; label: string; caps: Caps; model: string; modelSource: 'settings' | 'env' | 'default'; modelFast: string; modelFastSource: 'settings' | 'env' | 'default';
  enabled: boolean; proxy: string; customUrl: string | null; folder: string; keySource: Record<string, '' | 'env' | 'settings'>; providers: ProviderInfo[];
};
/** Field of PUT /ai/settings with the key of each service (gateway/src/lib/llmProviders.js). */
const KEY_FIELD: Record<string, string> = { openrouter: 'openrouterApiKey', anthropic: 'anthropicApiKey', openai: 'openaiApiKey', deepseek: 'deepseekApiKey', yandex: 'yandexApiKey', gigachat: 'gigachatAuthKey', custom: 'customApiKey' };
/** Services with a sentence on where the patient's data goes (`aiCard.privacy`). */
const PRIVACY = ['openrouter', 'anthropic', 'openai', 'deepseek', 'yandex', 'gigachat', 'custom'] as const;
const hasPrivacy = (id: string): id is typeof PRIVACY[number] => (PRIVACY as readonly string[]).includes(id);
const NOTE_RU: Record<string, string> = {
};
type Model = { id: string; name: string; context: number | null; input: string[]; promptPrice: number | null; completionPrice: number | null };

const PROVIDERS = ['openrouter', 'anthropic', 'openai', 'deepseek', 'yandex', 'gigachat', 'custom'] as const;
const isProvider = (id: string): id is (typeof PROVIDERS)[number] => (PROVIDERS as readonly string[]).includes(id);

export default function AiCard() {
  const t = useTranslations('settings');
  const providerLabel = (id: string, label: string) => (isProvider(id) ? t(`aiCard.provider.${id}`) : label);
  const price = (p: number | null) => (p == null ? '' : p === 0 ? t('aiCard.free') : `$${p < 1 ? p.toFixed(2) : p.toFixed(0)}`);
  const ed = useEdition();
  const [st, setSt] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [models, setModels] = useState<Model[] | null>(null);
  const [egress, setEgress] = useState<string | null>(null);
  // where the last answer is shown: next to the main check button or inside the details block, close to the button pressed
  const [inMore, setInMore] = useState(false);
  const [keyProvider, setKeyProvider] = useState('openrouter');
  const [keyValue, setKeyValue] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [folder, setFolder] = useState('');
  const [customModel, setCustomModel] = useState('');
  const [mainModel, setMainModel] = useState('');
  const [fastModel, setFastModel] = useState('');
  const [usage, setUsage] = useState<{ ym: string; calls: number; input: number; output: number; cacheRead: number }[]>([]);
  // The service, its address and keys need the password unless it was typed minutes ago (gateway: sensitiveConfirmed).
  // The gateway says when: 403 password_required. `askPassword` remembers which action waits for it.
  const [askPassword, setAskPassword] = useState<{ clear: boolean } | null>(null);
  const [password, setPassword] = useState('');

  const load = useCallback(async () => {
    const [r, u] = await Promise.all([apiFetch('/api/gateway/ai/status'), apiFetch('/api/gateway/ai/usage')]);
    if (r.ok) {
      const s = (await r.json()) as Status;
      setSt(s);
      if (s.provider !== 'none') setKeyProvider(s.provider);
      setBaseUrl(s.customUrl || ''); setFolder(s.folder || '');
      if (s.provider === 'custom') setCustomModel(s.model || '');
      setMainModel(s.model || ''); setFastModel(s.modelFast || '');
    }
    if (u.ok) setUsage((await u.json()).months || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function ping(tier: 'main' | 'fast' = 'main') {
    setInMore(tier === 'fast'); setBusy(true); setMsg(null); setErr(null);
    try {
      const r = await apiFetch('/api/gateway/ai/ping', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tier }) });
      const j = await r.json();
      if (!r.ok) throw new Error(errorRu(j));
      setMsg(t('aiCard.pingOk', { model: j.model, sec: (j.ms / 1000).toFixed(1), reply: String(j.reply).trim().slice(0, 80) }));
    } catch (e: any) { setErr(t('aiCard.pingFailed', { error: String(e?.message || e) })); } finally { setBusy(false); }
  }
  async function checkEgress() {
    setInMore(true); setBusy(true); setErr(null); setEgress(null);
    try {
      const r = await apiFetch('/api/gateway/ai/egress');
      const j = await r.json();
      if (!r.ok) throw new Error(errorRu(j));
      setEgress(j.ip);
    } catch (e: any) { setErr(t('aiCard.egressFailed', { error: String(e?.message || e) })); } finally { setBusy(false); }
  }
  async function choose(model: string, tier: 'main' | 'fast' = 'main') {
    setInMore(true); setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await apiFetch('/api/gateway/ai/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(tier === 'fast' ? { modelFast: model } : { model }) });
      const j = await r.json();
      if (!r.ok) throw new Error(errorRu(j));
      setMsg(model ? (tier === 'fast' ? t('aiCard.modelSetFast', { model: j.modelFast }) : t('aiCard.modelSetMain', { model: j.model })) : (tier === 'fast' ? t('aiCard.modelResetFast') : t('aiCard.modelResetMain')));
      await load();
    } catch (e: any) { setErr(String(e?.message || e)); } finally { setBusy(false); }
  }
  /** Save the service's key and fields and make it the one in use (the connect button), or remove the saved key. */
  async function saveKey(clear = false) {
    setInMore(false); setBusy(true); setErr(null); setMsg(null);
    try {
      const body: Record<string, string> = {};
      const field = KEY_FIELD[keyProvider];
      if (clear) body[field] = '';
      else {
        body.provider = keyProvider;
        if (keyValue.trim()) body[field] = keyValue.trim();
        if (keyProvider === 'custom') { body.baseUrl = baseUrl.trim(); body.model = customModel.trim(); body.modelFast = customModel.trim(); }
        if (keyProvider === 'yandex') body.yandexFolder = folder.trim();
      }
      if (password) body.password = password;
      const r = await apiFetch('/api/gateway/ai/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (r.status === 403 && (j.error === 'password_required' || j.error === 'invalid_password')) {
        setAskPassword({ clear }); setPassword('');
        if (j.error === 'invalid_password') setErr(errorRu(j));
        return;
      }
      if (!r.ok) throw new Error(errorRu(j));
      setAskPassword(null); setPassword('');
      setKeyValue(''); setMsg(clear ? t('aiCard.keyRemoved') : j.enabled ? t('aiCard.connected') : t('aiCard.savedIncomplete'));
      await load();
    } catch (e: any) { setErr(String(e?.message || e)); } finally { setBusy(false); }
  }
  async function search(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const r = await apiFetch(`/api/gateway/ai/models?q=${encodeURIComponent(q)}`);
      const j = await r.json();
      if (!r.ok) throw new Error(errorRu(j));
      setModels(j.models);
    } catch (e: any) { setErr(String(e?.message || e)); } finally { setBusy(false); }
  }

  const keyBlock = st && (() => {
    const info = st.providers.find((x) => x.id === keyProvider) || st.providers[0];
    const src = st.keySource?.[keyProvider] || '';
    const ready = Boolean(keyValue.trim() || info.keySet || info.keyOptional)
      && (!info.needsFolder || folder.trim()) && (keyProvider !== 'custom' || (baseUrl.trim() && customModel.trim()));
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <label className="field"><span>{t('aiCard.service')}</span>
          <select value={keyProvider} onChange={(e) => { setKeyProvider(e.target.value); setKeyValue(''); setAskPassword(null); setPassword(''); }} style={{ height: 36 }}>
            {st.providers.map((x) => <option key={x.id} value={x.id}>{x.keySet ? t('aiCard.providerKeySaved', { label: providerLabel(x.id, x.label) }) : providerLabel(x.id, x.label)}</option>)}
          </select>
        </label>
        {keyProvider === 'custom' && (
          <>
            <label className="field"><span>{t('aiCard.apiUrl')}</span>
              <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="http://192.168.1.10:11434/v1" autoComplete="off" inputMode="url" />
              <span className="muted" style={{ fontSize: 12 }}>{t('aiCard.apiUrlHint')}</span>
            </label>
            <label className="field"><span>{t('aiCard.model')}</span>
              <input value={customModel} onChange={(e) => setCustomModel(e.target.value)} placeholder={t('aiCard.modelPlaceholder')} autoComplete="off" />
            </label>
          </>
        )}
        {info.needsFolder && (
          <label className="field"><span>{t('aiCard.yandexFolder')}</span>
            <input value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="b1g…" autoComplete="off" />
          </label>
        )}
        {src === 'env'
          ? <span className="muted" style={{ fontSize: 13 }}>{t('aiCard.keyFromAdmin')}</span>
          : (
            <label className="field"><span>{t(info.keyOptional ? 'aiCard.keyLabelOptional' : 'aiCard.keyLabel', { kind: keyProvider === 'gigachat' ? 'auth' : 'api' })}</span>
              <input type="password" value={keyValue} onChange={(e) => setKeyValue(e.target.value)} autoComplete="off" placeholder={src === 'settings' ? t('aiCard.keySavedPlaceholder') : t('aiCard.keyPlaceholder')} />
              {info.keyUrl && <span className="muted" style={{ fontSize: 12 }}>{t('aiCard.keyWhere', { url: info.keyUrl })}</span>}
            </label>
          )}
        <div className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
          {hasPrivacy(info.id) ? t(`aiCard.privacy.${info.id}`) : ''}
          {!info.caps.pdf && <>{' '}{t('aiCard.pdfAsText')}</>}
          {info.note && NOTE_RU[info.note] ? <><br />{NOTE_RU[info.note]}</> : null}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn--primary btn--sm" onClick={() => saveKey(false)} disabled={busy || !ready}>{st.provider === keyProvider && st.enabled ? t('aiCard.save') : t('aiCard.connect')}</button>
          {src === 'settings' && <button type="button" className="btn btn--ghost btn--sm" onClick={() => saveKey(true)} disabled={busy}>{t('aiCard.removeKey')}</button>}
        </div>
        {askPassword && (
          <div className="msg msg--warning" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span>{t('aiCard.passwordHint')}</span>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && password && !busy) saveKey(askPassword.clear); }} placeholder={t('aiCard.passwordLabel')} aria-label={t('aiCard.passwordLabel')} autoComplete="current-password" autoFocus style={{ width: 200 }} />
              <button type="button" className="btn btn--primary btn--sm" onClick={() => saveKey(askPassword.clear)} disabled={busy || !password}>{t('aiCard.passwordConfirm')}</button>
            </div>
          </div>
        )}
        <div className="muted" style={{ fontSize: 12 }}>{ed.desktop ? t('aiCard.keysStoredDesktop') : t('aiCard.keysStoredServer')}</div>
      </div>
    );
  })();

  return (
    <div className="card meds-card">
      <div className="meds-card__row">
        <div className="card__title">{t('aiCard.title')}</div>
        <span className={`pill ${st?.enabled ? 'ok' : ''}`}>{!st ? '…' : st.enabled ? t('aiCard.working', { label: providerLabel(st.provider, st.label) }) : t('aiCard.off')}</span>
      </div>
      {st && !st.enabled && keyBlock}
      {st?.enabled && (
        <>
          <div><button type="button" className="btn btn--primary btn--sm" onClick={() => ping('main')} disabled={busy}>{t('aiCard.check')}</button></div>
          {!inMore && err && <div className="msg msg--error">{err}</div>}
          {!inMore && msg && <div className="msg msg--ok">{msg}</div>}
          <details className="settings-more">
            <summary>{t('aiCard.changeService')}</summary>
            <div style={{ marginTop: 8 }}>{keyBlock}</div>
          </details>
        </>
      )}
      {st && !st.enabled && err && <div className="msg msg--error">{err}</div>}
      {st && !st.enabled && msg && <div className="msg msg--ok">{msg}</div>}
      {st?.enabled && (
        <details className="settings-more">
          <summary>{t('aiCard.more')}</summary>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
            <div className="muted" style={{ fontSize: 14, lineHeight: 1.5 }}>
              {t.rich('aiCard.mainInfo', { model: st.model, source: st.modelSource, code: (c) => <code>{c}</code> })}
              <br />{t.rich('aiCard.fastInfo', { model: st.modelFast, source: st.modelFastSource, code: (c) => <code>{c}</code> })}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => ping('fast')} disabled={busy}>{t('aiCard.checkFast')}</button>
              {ed.available('egress') && <button type="button" className="btn btn--ghost btn--sm" onClick={checkEgress} disabled={busy}>{t('aiCard.egressCheck')}</button>}
            </div>
            {inMore && err && <div className="msg msg--error">{err}</div>}
            {inMore && msg && <div className="msg msg--ok">{msg}</div>}
            {usage.length > 0 && <div className="muted" style={{ fontSize: 13 }}>{t('aiCard.usage', { months: usage.slice(0, 2).map((m) => t('aiCard.usageMonth', { ym: m.ym, calls: m.calls, input: Math.round(m.input / 1000), output: Math.round(m.output / 1000) })).join(' · ') })}</div>}
            {egress && <div className="muted" style={{ fontSize: 13 }}>{t.rich('aiCard.egress', { via: st.proxy ? 'proxy' : 'direct', ip: egress, code: (c) => <code>{c}</code> })}</div>}
            {st.provider !== 'openrouter' && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <label className="field" style={{ flex: '1 1 180px' }}><span>{t('aiCard.mainModel')}</span><input value={mainModel} onChange={(e) => setMainModel(e.target.value)} autoComplete="off" /></label>
                <label className="field" style={{ flex: '1 1 180px' }}><span>{t('aiCard.fastModel')}</span><input value={fastModel} onChange={(e) => setFastModel(e.target.value)} autoComplete="off" /></label>
                <button type="button" className="btn btn--secondary btn--sm" disabled={busy || (mainModel === st.model && fastModel === st.modelFast)} onClick={async () => { if (mainModel !== st.model) await choose(mainModel.trim(), 'main'); if (fastModel !== st.modelFast) await choose(fastModel.trim(), 'fast'); }}>{t('aiCard.saveModels')}</button>
              </div>
            )}
            {st.provider === 'openrouter' && (
              <form onSubmit={search} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('aiCard.searchPlaceholder')} style={{ flex: 1, minWidth: 200 }} />
                <button type="submit" className="btn btn--secondary btn--sm" disabled={busy}>{t('aiCard.search')}</button>
              </form>
            )}
            {models && (
              <div className="sheet__list">
                {models.length === 0 && <div className="muted">{t('aiCard.nothingFound')}</div>}
                {models.map((m) => (
                  <div key={m.id} className="list-row">
                    <span style={{ minWidth: 0 }}>
                      <code>{m.id}</code>{m.input.includes('file') || m.input.includes('image') ? '' : ` · ${t('aiCard.noPdf')}`}
                      <br /><span className="muted" style={{ fontSize: 13 }}>{m.promptPrice != null ? t('aiCard.price', { input: price(m.promptPrice), output: price(m.completionPrice) }) : ''}</span>
                    </span>
                    <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {st.model === m.id ? <span className="pill ok">{t('aiCard.isMain')}</span> : <button type="button" className="btn btn--secondary btn--sm" disabled={busy} onClick={() => choose(m.id, 'main')}>{t('aiCard.setMain')}</button>}
                      {st.modelFast === m.id ? <span className="pill ok">{t('aiCard.isFast')}</span> : <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => choose(m.id, 'fast')}>{t('aiCard.setFast')}</button>}
                    </span>
                  </div>
                ))}
                <div className="muted" style={{ fontSize: 13 }}>{t('aiCard.choiceHint')}{st.modelSource === 'settings' && <> <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => choose('', 'main')}>{t('aiCard.mainDefault')}</button></>}{st.modelFastSource === 'settings' && <> <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => choose('', 'fast')}>{t('aiCard.fastDefault')}</button></>}</div>
              </div>
            )}
          </div>
        </details>
      )}
    </div>
  );
}
