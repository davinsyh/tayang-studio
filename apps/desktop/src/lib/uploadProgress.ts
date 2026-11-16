export interface PostUploadProgress {
  projectId: string;
  accountId: string;
  platform: string;
  stage: string;
  sent: number;
  total: number;
}

export function uploadPercent(progress: PostUploadProgress): number | null {
  if (!Number.isFinite(progress.total) || progress.total <= 0 || !Number.isFinite(progress.sent)) return null;
  const percent = Math.floor(Math.max(0, progress.sent) / progress.total * 100);
  return Math.min(progress.stage === 'uploading' ? 99 : 100, percent);
}
