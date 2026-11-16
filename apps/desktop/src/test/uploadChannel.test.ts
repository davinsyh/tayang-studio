import { expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), Channel: class { onmessage = (_: unknown) => {}; } }));
import { invoke } from '@tauri-apps/api/core';
import { socialPost } from '@/lib/cloud';

it('registers the progress channel before invoking and ignores late events after completion', async () => {
  const received = vi.fn();
  let channel!: { onmessage(event: unknown): void };
  vi.mocked(invoke).mockImplementation(async (_command, args) => {
    channel = (args as { onProgress: typeof channel }).onProgress;
    expect(typeof channel).toBe('object');
    channel.onmessage({ stage: 'uploading', sent: 50, total: 100 });
    return { postId: 'p', status: 'processing' } as never;
  });
  await socialPost({ projectId: 'p', caption: 'Caption', accountIds: ['yt:own'], scheduledAt: null, clientRequestId: 'request', onProgress: received });
  expect(received).toHaveBeenCalledWith({ stage: 'uploading', sent: 50, total: 100 });
  channel.onmessage({ stage: 'failed' });
  expect(received).toHaveBeenCalledTimes(1);
});
