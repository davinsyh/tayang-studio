import type { PostDetails } from '@tayang/shared';

export function deliveryPending(result: PostDetails['results'][number], groupStatus: string): boolean {
  if (result.status) return ['pending', 'queued', 'publishing', 'processing', 'uploading', 'in_progress'].includes(result.status);
  return groupStatus === 'processing' && !result.success && !result.error && !result.url;
}
