'use client';

import Icon from './icons';

type Who = { callName: string; name: string; photo: string };

/** One or two letters: the short name's first, otherwise the first letters of the full name. */
export function initials({ callName, name }: Pick<Who, 'callName' | 'name'>) {
  const short = callName.trim();
  if (short) return short[0].toUpperCase();
  return name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}

/** The person the diary is about: photo, else initials; nothing when neither is known (placeholder: an empty circle). */
export function Avatar({ who, size, placeholder = false }: { who: Who; size: number; placeholder?: boolean }) {
  const letters = initials(who);
  if (!who.photo && !letters && !placeholder) return null;
  const empty = !who.photo && !letters;
  return (
    <div className={`avatar ${empty ? 'avatar--empty' : ''}`} style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }} aria-hidden="true">
      {who.photo ? <img src={who.photo} alt="" /> : letters || <Icon name="user" size={Math.round(size * 0.5)} />}
    </div>
  );
}

/** A picture file → a 160×160 JPEG data URL, cropped to the centre, EXIF rotation applied. Small enough for a setting. */
export async function squarePhoto(file: File, size = 160): Promise<string> {
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no canvas');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size);
  bmp.close();
  return canvas.toDataURL('image/jpeg', 0.85);
}
