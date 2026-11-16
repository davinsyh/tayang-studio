import { describe, expect, it } from 'vitest';
import { isShortsFormat, shortsPlayerUrl } from '@/lib/shorts';

describe('Shorts format and player links', () => {
  const media = { width: 1080, height: 1920, durationSec: 80, fps: 30, frames: 2400 };
  it('accepts vertical and square videos through 180 seconds, excluding landscape and longer videos', () => {
    expect(isShortsFormat(media)).toBe(true);
    expect(isShortsFormat({ ...media, height: 1080, durationSec: 180 })).toBe(true);
    expect(isShortsFormat({ ...media, durationSec: 180.01 })).toBe(false);
    expect(isShortsFormat({ ...media, width: 1920, height: 1080 })).toBe(false);
    expect(isShortsFormat(null)).toBe(false);
    expect(isShortsFormat({ ...media, durationSec: 0 })).toBe(false);
  });
  it('only rewrites a YouTube watch URL with a valid video ID', () => {
    expect(shortsPlayerUrl('https://www.youtube.com/watch?v=EKZKpjfLc5o')).toBe('https://www.youtube.com/shorts/EKZKpjfLc5o');
    expect(shortsPlayerUrl('https://example.com/watch?v=EKZKpjfLc5o')).toBeNull();
    expect(shortsPlayerUrl('https://www.youtube.com/watch?v=bad')).toBeNull();
    expect(shortsPlayerUrl('invalid')).toBeNull();
  });
});
