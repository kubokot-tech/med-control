'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'use-intl';
import { apiFetch } from './labUtils';
import { errorRu } from './api';
import { useFormat } from './format';
import { useEdition } from './edition';
import ReminderTimes from './ReminderTimes';

export type NotifyStatus = {
  telegram: { tokenSet: boolean; chatSet: boolean; ready: boolean; bot: { username: string; name: string } | null; tokenSource?: '' | 'env' | 'settings'; chatSource?: '' | 'env' | 'settings' };
  schedule: { doseAt: string; doseAgainAt: string; labStaleDays: number; fromEnv?: string[] };
  appUrl: string;
  backup?: { ok: boolean; line: string; problems: string[]; warnings?: string[]; ran_at: string; mirror: { enabled: boolean; state: string }; cloud: { enabled: boolean; state: string; remote: string }; restore_test: { state: string; detail: string } } | null;
  recent: { kind: string; ref: string; sent_at: string; text: string | null }[];
};

/** Kinds of sent messages with a name in `telegramCard.kind`. */
const KIND: Record<string, 'dose' | 'doseAgain' | 'alert' | 'labsStale' | 'test' | 'appt7d' | 'appt1d' | 'appt0d' | 'apptReport' | 'backupDaily' | 'backupFail'> = { dose: 'dose', dose_again: 'doseAgain', alert: 'alert', labs_stale: 'labsStale', test: 'test', appt_7d: 'appt7d', appt_1d: 'appt1d', appt_0d: 'appt0d', appt_report: 'apptReport', backup_daily: 'backupDaily', backup_fail: 'backupFail' };

/** Telegram reminders: what comes, step-by-step connection, test message, recent sends. */
export default function TelegramCard() {
  const t = useTranslations('settings');
  const ed = useEdition();
  const f = useFormat();
  const [status, setStatus] = useState<NotifyStatus | null>(null);
  const [chats, setChats] = useState<{ id: string; name: string }[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tgToken, setTgToken] = useState('');
  // The bot and the chat need the password unless it was typed minutes ago (gateway: sensitiveConfirmed, 403
  // password_required). `askPassword` keeps the change that waits for it.
  const [askPassword, setAskPassword] = useState<{ body: { token?: string; chatId?: string }; done: string } | null>(null);
  const [password, setPassword] = useState('');

  const load = useCallback(async () => {
    const s = await apiFetch('/api/gateway/notify/status');
    if (s.ok) setStatus(await s.json());
  }, []);
  useEffect(() => { load(); }, [load]);

  async function saveTelegram(body: { token?: string; chatId?: string }, done: string) {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await apiFetch('/api/gateway/notify/telegram', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(password ? { ...body, password } : body) });
      const j = await r.json().catch(() => ({}));
      if (r.status === 403 && (j.error === 'password_required' || j.error === 'invalid_password')) {
        setAskPassword({ body, done }); setPassword('');
        if (j.error === 'invalid_password') setErr(errorRu(j));
        return;
      }
      if (!r.ok) throw new Error(errorRu(j));
      setAskPassword(null); setPassword('');
      setTgToken(''); setChats(null); setMsg(done);
      await load();
    } catch (e: any) { setErr(String(e?.message || e)); } finally { setBusy(false); }
  }
  async function discover() {
    setBusy(true); setErr(null); setChats(null);
    try {
      const r = await apiFetch('/api/gateway/notify/telegram/discover');
      const j = await r.json();
      if (!r.ok) throw new Error(errorRu(j));
      setChats(j.chats || []);
    } catch (e: any) { setErr(String(e?.message || e)); } finally { setBusy(false); }
  }
  async function test(chatId?: string) {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await apiFetch('/api/gateway/notify/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(chatId ? { chatId } : {}) });
      const j = await r.json();
      if (!r.ok) throw new Error(errorRu(j));
      setMsg(t('telegramCard.testSent'));
      load();
    } catch (e: any) { setErr(String(e?.message || e)); } finally { setBusy(false); }
  }

  const tg = status?.telegram;
  const step = !tg ? 0 : tg.ready ? 3 : tg.tokenSet ? 2 : 1;
  const feedback = (
    <>
      {askPassword && (
        <div className="msg msg--warning" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span>{t('telegramCard.passwordHint')}</span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && password && !busy) saveTelegram(askPassword.body, askPassword.done); }} placeholder={t('telegramCard.passwordLabel')} aria-label={t('telegramCard.passwordLabel')} autoComplete="current-password" autoFocus style={{ width: 200 }} />
            <button type="button" className="btn btn--primary btn--sm" onClick={() => saveTelegram(askPassword.body, askPassword.done)} disabled={busy || !password}>{t('telegramCard.passwordConfirm')}</button>
          </div>
        </div>
      )}
      {err && <div className="msg msg--error">{err}</div>}
      {msg && <div className="msg msg--ok">{msg}</div>}
    </>
  );

  return (
    <div className="card meds-card">
      <div className="meds-card__row">
        <div className="card__title">{t('telegramCard.title')}</div>
        <span className={`pill ${tg?.ready ? 'ok' : ''}`}>{tg?.ready ? t('telegramCard.connected') : t('telegramCard.notConnected')}</span>
      </div>
      {ed.desktop && <div className="msg msg--warning">{t('telegramCard.desktopWarning')}</div>}
      <div className="muted" style={{ fontSize: 14, lineHeight: 1.5 }}>
        {status?.schedule.doseAgainAt
          ? t('telegramCard.whatComesAgain', { dose: f.clock(status.schedule.doseAt || '11:00'), again: f.clock(status.schedule.doseAgainAt), days: status.schedule.labStaleDays || 28 })
          : t('telegramCard.whatComes', { dose: f.clock(status?.schedule.doseAt || '11:00'), days: status?.schedule.labStaleDays || 28 })}
      </div>
      {status && <details><summary className="muted" style={{ cursor: 'pointer', fontSize: 14 }}>{t('telegramCard.changeTimes')}</summary><div style={{ marginTop: 8 }}><ReminderTimes schedule={status.schedule} onSaved={load} /></div></details>}

      {tg?.ready && (
        <>
          {tg.bot && <div>{t.rich('telegramCard.bot', { username: tg.bot.username, b: (c) => <b>{c}</b> })}</div>}
          <div className="muted" style={{ fontSize: 14, lineHeight: 1.5 }}>{t('telegramCard.botUsage')}</div>
          <div><button type="button" className="btn btn--primary btn--sm" onClick={() => test()} disabled={busy}>{t('telegramCard.sendTest')}</button></div>
          {feedback}
        </>
      )}

      {tg && !tg.ready && (
        <ol className="settings-steps">
          <li className={step === 1 ? '' : 'muted'}>
            {t.rich('telegramCard.step1', { code: (c) => <code>{c}</code> })}
            {step === 1 && tg.tokenSource !== 'env' && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
                <input type="password" value={tgToken} onChange={(e) => setTgToken(e.target.value)} autoComplete="off" placeholder={t('telegramCard.tokenPlaceholder')} style={{ flex: 1, minWidth: 200 }} />
                <button type="button" className="btn btn--primary btn--sm" onClick={() => saveTelegram({ token: tgToken.trim() }, t('telegramCard.tokenSaved'))} disabled={busy || !tgToken.trim()}>{t('telegramCard.save')}</button>
              </div>
            )}
          </li>
          <li className={step === 2 ? '' : 'muted'}>
            {t('telegramCard.step2')}
            {step === 2 && <div style={{ marginTop: 8 }}><button type="button" className="btn btn--primary btn--sm" onClick={discover} disabled={busy}>{t('telegramCard.findChat')}</button></div>}
          </li>
          <li className={step === 2 && chats ? '' : 'muted'}>
            {t('telegramCard.step3')}
            {chats && (
              <div className="sheet__list" style={{ marginTop: 6 }}>
                {chats.length === 0 && <div className="muted">{t('telegramCard.noChats')}</div>}
                {chats.map((c) => (
                  <div key={c.id} className="list-row">
                    <span>{c.name || t('telegramCard.chat')}</span>
                    {tg.chatSource !== 'env' && <button type="button" className="btn btn--secondary btn--sm" onClick={() => saveTelegram({ chatId: c.id }, t('telegramCard.chatConnected'))} disabled={busy}>{t('telegramCard.myChat')}</button>}
                  </div>
                ))}
              </div>
            )}
          </li>
        </ol>
      )}
      {tg && !tg.ready && feedback}

      {tg && (tg.ready || tg.tokenSet) && (
        <details className="settings-more">
          <summary>{t('telegramCard.more')}</summary>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
            {tg.tokenSource !== 'env' ? (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <input type="password" value={tgToken} onChange={(e) => setTgToken(e.target.value)} autoComplete="off" placeholder={t('telegramCard.newTokenPlaceholder')} style={{ flex: 1, minWidth: 200 }} />
                <button type="button" className="btn btn--secondary btn--sm" onClick={() => saveTelegram({ token: tgToken.trim() }, t('telegramCard.tokenReplaced'))} disabled={busy || !tgToken.trim()}>{t('telegramCard.replaceToken')}</button>
              </div>
            ) : <div className="muted" style={{ fontSize: 13 }}>{t('telegramCard.tokenFromAdmin')}</div>}
            {tg.ready && <div><button type="button" className="btn btn--ghost btn--sm" onClick={discover} disabled={busy}>{t('telegramCard.otherChat')}</button></div>}
            {tg.ready && chats && chats.map((c) => (
              <div key={c.id} className="list-row">
                <span>{c.name || t('telegramCard.chat')}</span>
                {tg.chatSource !== 'env' && <button type="button" className="btn btn--secondary btn--sm" onClick={() => saveTelegram({ chatId: c.id }, t('telegramCard.chatSaved'))} disabled={busy}>{t('telegramCard.myChat')}</button>}
              </div>
            ))}
            {status && status.recent.length > 0 && (
              <div className="dose-history">
                <div className="section-label">{t('telegramCard.recent')}</div>
                {status.recent.slice(0, 5).map((n, i) => (
                  <div key={i} className="dose-history__row"><span className="muted">{f.date(n.sent_at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span><span>{KIND[n.kind] ? t(`telegramCard.kind.${KIND[n.kind]}`) : n.kind}</span></div>
                ))}
              </div>
            )}
          </div>
        </details>
      )}
    </div>
  );
}
