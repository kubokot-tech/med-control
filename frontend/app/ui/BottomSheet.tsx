'use client';

import { useEffect, useRef } from 'react';
import { useTranslations } from 'use-intl';
import Icon from './icons';

/**
 * Bottom sheet on phones, right-hand side panel on desktop (CSS decides).
 * Built on the native <dialog>: focus trap, Esc and backdrop come for free.
 */
export default function BottomSheet({
  open,
  onClose,
  title,
  error,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  error?: string | null;
  children: React.ReactNode;
}) {
  const t = useTranslations('ui');
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="sheet"
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
      aria-labelledby={title ? 'sheet-title' : undefined}
    >
      <div className="sheet__inner">
        <div className="sheet__grip" />
        <div className="sheet__head">
            {title ? <div id="sheet-title" className="sheet__title">{title}</div> : <span />}
            <button type="button" className="sheet__close" onClick={onClose} aria-label={t('bottomSheet.close')}><Icon name="close" /></button>
        </div>
        {error && <div role="alert" className="msg msg--error">{error}</div>}
        {children}
      </div>
    </dialog>
  );
}
