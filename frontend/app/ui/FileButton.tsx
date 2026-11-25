'use client';

import { useState, type InputHTMLAttributes, type ReactNode, type Ref } from 'react';
import { useTranslations } from 'use-intl';

// Only the iPad static export needs an eager copy of the chosen file.
const DIRECT = process.env.NEXT_PUBLIC_STATIC_EXPORT === '1';

export type RememberedFile = File & { mcBytes?: Uint8Array };

/** Copy the bytes now. On iPad a file from the picker dies when the input is cleared, and a later read never finishes. */
export function rememberFiles(list: FileList | File[]): Promise<RememberedFile[]> {
  // Copy before any await: a FileList is live and dies when the input is cleared.
  const files = Array.from(list);
  if (!DIRECT) return Promise.resolve(files);
  return Promise.all(files.map((f) => new Promise<RememberedFile>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const bytes = new Uint8Array(reader.result as ArrayBuffer);
      const file = new File([bytes], f.name, { type: f.type, lastModified: f.lastModified }) as RememberedFile;
      file.mcBytes = bytes;
      resolve(file);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(f);
  })));
}

/** Read the chosen files, then clear the input. Clearing first drops the bytes on iPad. */
export function takeFiles(input: HTMLInputElement, onFiles: (files: RememberedFile[]) => void, onError?: () => void) {
  const picked = Array.from(input.files || []);
  if (!picked.length) return;
  // Server and desktop stream the files into multipart: reading every byte into JS memory here would
  // triple the peak for a large archive. Only the iPad build needs the copies.
  if (!DIRECT) { input.value = ''; onFiles(picked); return; }
  void rememberFiles(picked).then((files) => {
    input.value = '';
    onFiles(files);
  }, () => {
    input.value = '';
    onError?.();
  });
}

type Props = Omit<InputHTMLAttributes<HTMLLabelElement>, 'onChange' | 'children'> & {
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  inputId?: string;
  inputRef?: Ref<HTMLInputElement>;
  onFiles: (files: File[]) => void;
  children: ReactNode;
};

/**
 * The control the person taps to choose files. iPad's web view ignores a scripted click() on a
 * hidden input. The transparent native input accepts keyboard, pointer and touch on all platforms.
 */
export default function FileButton({ accept, multiple, disabled, inputId, inputRef, onFiles, className, children, ...rest }: Props) {
  const t = useTranslations('common');
  const [readError, setReadError] = useState<string | null>(null);
  const classes = [className, 'file-btn'].filter(Boolean).join(' ');
  return (
    <>
      <label className={classes || undefined} aria-disabled={disabled ? true : undefined} {...rest}>
        {children}
        <input
          id={inputId}
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          disabled={disabled}
          onChange={(e) => {
            takeFiles(e.target, (files) => { setReadError(null); onFiles(files); }, () => setReadError(t('fileUnread')));
          }}
        />
      </label>
      {readError && <div style={{ color: 'var(--danger)', fontSize: 13 }}>{readError}</div>}
    </>
  );
}
