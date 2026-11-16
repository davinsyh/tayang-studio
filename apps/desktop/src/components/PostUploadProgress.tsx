import { useTranslation } from 'react-i18next';
import type { SocialAccount } from '@tayang/shared';
import { PlatformLogo } from './PlatformLogo';
import { Spinner } from './Loading';
import { platformName } from '@/lib/cloud';
import { uploadPercent, type PostUploadProgress } from '@/lib/uploadProgress';

export function PostUploadProgressPanel({ accounts, progress }: {
  accounts: Pick<SocialAccount, 'id' | 'platform' | 'username'>[];
  progress: Record<string, PostUploadProgress>;
}) {
  const { t } = useTranslation();
  return <section aria-label={t('post.uploadProgress')} className="flex flex-col gap-4">
    <p className="m-0 text-xs text-text-3">{t('post.uploadProgressHint')}</p>
    {accounts.map(account => {
      const current = progress[account.id];
      const stage = current?.stage ?? 'waiting';
      const percent = current ? uploadPercent(current) : null;
      const name = account.platform === 'cloud' ? t('post.uploadVideo') : `${platformName(account.platform)}${account.username ? ` · @${account.username}` : ''}`;
      const active = !['waiting', 'failed', 'published', 'scheduled'].includes(stage);
      const label = stage === 'waiting' ? t('post.uploadWaiting')
        : stage === 'preparing' ? t('post.uploadPreparing')
        : stage === 'uploading' ? t('post.uploadSending')
        : stage === 'published' ? t('post.ok')
        : stage === 'scheduled' ? t('social.waiting')
        : stage === 'failed' ? t('post.failed')
        : stage === 'checking' ? t('social.checkingStatus') : t('post.uploadProcessing');
      return <div key={account.id} className="flex flex-col gap-2 rounded-md border border-border p-3">
        <div className="flex items-center gap-2 text-sm">
          {account.platform !== 'cloud' && <PlatformLogo platform={account.platform} size={16} />}
          <span className="min-w-0 flex-1 truncate">{name}</span>
          {percent !== null && stage !== 'preparing' && stage !== 'failed' && <span className="tabular-nums">{percent}%</span>}
        </div>
        {current && !['waiting', 'preparing', 'failed'].includes(stage) && <progress aria-label={name} max={100} value={percent ?? undefined} className="h-2 w-full appearance-none overflow-hidden rounded-full [&::-webkit-progress-bar]:bg-border [&::-webkit-progress-value]:bg-primary [&::-moz-progress-bar]:bg-primary" />}
        <div role="status" className="flex items-center gap-2 text-xs text-text-2">
          {active && <Spinner size={12} />}{label}
        </div>
        {current && current.total > 0 && stage === 'uploading' && <span className="text-xs text-text-3 tabular-nums">{t('post.uploadBytes', { sent: (current.sent / 1_000_000).toFixed(1), total: (current.total / 1_000_000).toFixed(1) })}</span>}
      </div>;
    })}
  </section>;
}
