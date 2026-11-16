import type { MediaInfo } from '@tayang/shared';

export function isShortsFormat(media: MediaInfo | null): boolean {
  return !!media && media.width > 0 && media.height >= media.width && media.durationSec > 0 && media.durationSec <= 180;
}

export function shortsPlayerUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'www.youtube.com' && parsed.hostname !== 'youtube.com') return null;
    const id = parsed.pathname === '/watch' ? parsed.searchParams.get('v') : null;
    return id && /^[\w-]{11}$/.test(id) ? `https://www.youtube.com/shorts/${id}` : null;
  } catch {
    return null;
  }
}
