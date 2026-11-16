'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'use-intl';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { apiFetch } from './labUtils';

/** <img> for dtc://<sha256> references: fetches the attachment with the token and shows a blob URL. */
function AuthImg({ src, alt }: { src?: string; alt?: string }) {
  const t = useTranslations('ui');
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let revoke: string | null = null;
    const m = /^dtc:\/\/([a-f0-9]{64})$/i.exec(src || '');
    // external images are not loaded automatically (tracking pixels in imported notes or AI text)
    if (!m) { setUrl(null); return; }
    apiFetch(`/api/gateway/attachments/${m[1]}?inline=1`).then(async (r) => { if (r.ok) { revoke = URL.createObjectURL(await r.blob()); setUrl(revoke); } });
    return () => { if (revoke) URL.revokeObjectURL(revoke); };
  }, [src]);
  if (!url) return /^https?:/i.test(src || '') ? <a href={src} target="_blank" rel="noopener noreferrer">{t('markdown.externalImage', { alt: alt || t('markdown.open') })}</a> : <span className="muted">{t('markdown.image')}</span>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={alt || ''} style={{ maxWidth: '100%', borderRadius: 8 }} />;
}

// Keep dtc:// (attachments) and http(s)/mailto links; everything else (javascript:, data:) becomes empty.
const urlTransform = (url: string) => (/^(https?:|mailto:|dtc:\/\/|#|\/)/i.test(url) ? url : '');

export default function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={urlTransform} components={{
        img: ({ src, alt }) => <AuthImg src={typeof src === 'string' ? src : undefined} alt={alt} />,
        a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
      }}>{text}</ReactMarkdown>
    </div>
  );
}
