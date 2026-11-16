'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'use-intl';
import Icon from './icons';
import AiAsk from './AiAsk';
import { apiFetch } from './labUtils';
import { useFormat } from './format';

type Thread = { id: string; n: number; lastAt: string; title: string };
const KEY = 'dtc_chat_thread';
const INTRO_KEY = 'mc_ai_intro_seen';
const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : '00000000-0000-4000-8000-' + Date.now().toString(16).padStart(12, '0').slice(-12));

/** Floating assistant (the round button): a chat with the AI that sees the patient profile and the open page. */
export default function ChatWidget() {
  const t = useTranslations('ai');
  const f = useFormat();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [thread, setThread] = useState<string>('');
  const [threads, setThreads] = useState<Thread[] | null>(null);
  const [showList, setShowList] = useState(false);
  const [deep, setDeep] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const toBottom = () => setTimeout(() => bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' }), 50);
  useEffect(() => { if (open && !showList) setTimeout(() => bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight }), 400); }, [open, showList, thread]);

  // Without a configured AI the button is hidden, except once: then it explains what AI gives and where to connect it.
  const [ai, setAi] = useState<'on' | 'off' | null>(null);
  const [introSeen, setIntroSeen] = useState(true);
  useEffect(() => { try { setIntroSeen(localStorage.getItem(INTRO_KEY) === '1'); } catch { setIntroSeen(true); } }, []);
  useEffect(() => { apiFetch('/api/gateway/ai/status').then(async (r) => setAi(r.ok && (await r.json()).enabled ? 'on' : 'off')).catch(() => setAi('off')); }, [pathname]);
  const seeIntro = () => { try { localStorage.setItem(INTRO_KEY, '1'); } catch { /* ignore */ } setIntroSeen(true); };

  useEffect(() => { try { setThread(localStorage.getItem(KEY) || newId()); } catch { setThread(newId()); } }, []);
  useEffect(() => { if (thread) try { localStorage.setItem(KEY, thread); } catch { /* ignore */ } }, [thread]);
  const loadThreads = useCallback(async () => { const r = await apiFetch('/api/gateway/ai/chats'); if (r.ok) setThreads((await r.json()).chats); }, []);
  useEffect(() => { if (open && showList) loadThreads(); }, [open, showList, loadThreads]);

  if (pathname === '/login' || pathname === '/offline' || ai === null) return null;
  if (ai === 'off') {
    if (introSeen && !open) return null;
    return (
      <>
        {!open && (
          <button type="button" className="chatw-fab" onClick={() => setOpen(true)} aria-label={t('chat.introFab')} title={t('chat.introFab')}>
            <Icon name="ai" size={28} />
          </button>
        )}
        {open && (
          <div className="chatw-panel" role="dialog" aria-label={t('chat.introTitle')}>
            <div className="chatw-head">
              <Icon name="ai" size={22} />
              <b style={{ flex: 1 }}>{t('chat.introTitle')}</b>
              <button type="button" className="sheet__close" onClick={() => { setOpen(false); seeIntro(); }} aria-label={t('chat.close')}><Icon name="close" /></button>
            </div>
            <div className="chatw-body" style={{ display: 'flex', flexDirection: 'column', gap: 12, lineHeight: 1.5 }}>
              <div>{t('chat.introLead')}</div>
              <ul style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <li>{t('chat.introParse')}</li>
                <li>{t('chat.introComment')}</li>
                <li>{t('chat.introConsult')}</li>
                <li>{t('chat.introChat')}</li>
              </ul>
              <div className="muted" style={{ fontSize: 14 }}>{t('chat.introKeys')}</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Link href="/settings/ai" className="btn btn--primary btn--sm" onClick={() => { setOpen(false); seeIntro(); }}>{t('chat.introConnect')}</Link>
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => { setOpen(false); seeIntro(); }}>{t('chat.introOk')}</button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }
  const when = (iso: string) => f.date(iso, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  return (
    <>
      {!open && (
        <button type="button" className="chatw-fab" onClick={() => setOpen(true)} aria-label={t('chat.fab')} title={t('chat.fab')}>
          <Icon name="ai" size={28} />
        </button>
      )}
      {open && (
        <div className="chatw-panel" role="dialog" aria-label={t('chat.dialog')}>
          <div className="chatw-head">
            <Icon name="ai" size={22} />
            <b style={{ flex: 1 }}>{showList ? t('chat.threads') : t('chat.assistant')}</b>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setShowList(!showList)}>{showList ? t('chat.back') : t('chat.history')}</button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => { setThread(newId()); setShowList(false); }}>{t('chat.new')}</button>
            <button type="button" className="sheet__close" onClick={() => setOpen(false)} aria-label={t('chat.close')}><Icon name="close" /></button>
          </div>
          <div className="chatw-body" ref={bodyRef}>
            {showList ? (
              <div className="sheet__list">
                {threads === null && <div className="muted">{t('chat.loading')}</div>}
                {threads?.length === 0 && <div className="muted">{t('chat.noThreads')}</div>}
                {threads?.map((th) => (
                  <button key={th.id} type="button" className="list-row" style={{ textAlign: 'left', background: th.id === thread ? 'var(--surface-2)' : 'none', border: 0, cursor: 'pointer' }} onClick={() => { setThread(th.id); setShowList(false); }}>
                    <span>{th.title || t('chat.untitled')}<br /><span className="muted" style={{ fontSize: 12 }}>{t('chat.threadMeta', { when: when(th.lastAt), n: th.n })}</span></span>
                  </button>
                ))}
              </div>
            ) : (
              <>
                <div className="muted" style={{ fontSize: 13, lineHeight: 1.45 }}>{t('chat.disclaimer')}</div>
                {thread && <AiAsk key={thread} subjectType="chat" subjectId={thread} markdown hideBar placeholder={t('chat.placeholder')} extra={() => ({ page: window.location.pathname, deep })} onAsked={() => { setThreads(null); toBottom(); }} />}
                <label className="chatw-deep"><input type="checkbox" checked={deep} onChange={(e) => setDeep(e.target.checked)} /> {t('chat.deep')}</label>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
