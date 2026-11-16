import { expect, it } from 'vitest';
import { deliveryPending } from '@/lib/postStatus';

it('distinguishes an in-progress TikTok delivery from a rejected delivery in a mixed-platform post', () => {
  const result = { socialAccountId: 'z:tiktok', success: false, error: null, url: null };
  expect(deliveryPending({ ...result, status: 'publishing' }, 'processing')).toBe(true);
  expect(deliveryPending({ ...result, status: 'publishing' }, 'failed')).toBe(true);
  expect(deliveryPending({ ...result, status: 'failed' }, 'processing')).toBe(false);
  expect(deliveryPending({ ...result, status: 'failed', error: 'TikTok rejected this video' }, 'failed')).toBe(false);
  expect(deliveryPending(result, 'processing')).toBe(true);
  expect(deliveryPending({ ...result, status: 'published', success: true }, 'published')).toBe(false);
});
