'use client';

import { useTranslations } from 'use-intl';

/** What the model saw: the exact prompt data stored next to an AI answer, for checking numbers. */
export default function AiContext({ context }: { context?: string | null }) {
  const t = useTranslations('ai');
  if (!context) return null;
  return (
    <details className="ai-context">
      <summary className="muted" style={{ cursor: 'pointer', fontSize: 13 }}>{t('context.summary')}</summary>
      <pre className="ai-context__pre">{context}</pre>
    </details>
  );
}
