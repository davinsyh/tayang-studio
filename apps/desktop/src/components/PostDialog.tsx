import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink, Sparkles } from 'lucide-react';
import type { CreatePostResponse, MediaInfo, PostDetails, Project, SocialAccount } from '@tayang/shared';
import { Button } from '@/components/Button';
import { Spinner } from '@/components/Loading';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useCloudError } from '@/components/SocialAccounts';
import { PlatformLogo } from '@/components/PlatformLogo';
import { defaultSlot, localToIso } from '@/components/ScheduleDialog';
import { cloudErrorCode, platformName, socialAccounts, socialPost, socialPostStatus, type CloudErrorCode } from '@/lib/cloud';
import { listProjects, mediaProbe } from '@/lib/ipc';
import { isShortsFormat, shortsPlayerUrl } from '@/lib/shorts';
import { captionOf, readPostDraft, TITLE_MAX, type PostDraft } from '@/lib/postDraft';
import { useApp } from '@/state/app';
import { track } from '@/lib/analytics';
import { useHybrid } from '@/lib/hybrid';
import { TikTokOptions } from '@/components/HybridPostOptions';

const pad = (n: number) => String(n).padStart(2, '0');
const dateValue = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeValue = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

type Phase = { kind: 'form' } | { kind: 'posting' } | { kind: 'done'; result: CreatePostResponse };

/**
 * Posts the project's latest render to the user's connected social accounts, now or at a set time,
 * through the Tayang account (one auto-post per account). Once posted it shows how it went on each.
 * A retry after an error reuses the request id, so the video never goes out twice.
 */
export function PostDialog({
  open,
  onOpenChange,
  project,
  onPosted,
  onAskAgent,
  agentBusy = false,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  project: Project;
  onPosted(p: Project): void;
  /** Asks the chat's agent to write post.json (title, description, hashtags, a time). */
  onAskAgent?: () => void;
  /** The chat's agent is working. */
  agentBusy?: boolean;
}) {
  const { t } = useTranslation();
  const hybrid = useHybrid(s => s.settings?.enabled ?? false);
  const [tiktokSettings, setTiktokSettings] = useState<Record<string,unknown>>();
  const [youtubePrivacy, setYoutubePrivacy] = useState('private');
  const [kids, setKids] = useState(false);
  const [hybridError, setHybridError] = useState('');
  const [media, setMedia] = useState<MediaInfo | null>(null);
  useEffect(() => { if(open) void useHybrid.getState().refresh(); }, [open]);
  const explain = useCloudError();
  const navigate = useApp((s) => s.navigate);
  const [accounts, setAccounts] = useState<SocialAccount[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [title, setTitle] = useState(project.title);
  const [caption, setCaption] = useState(project.title);
  // The fields came from the agent's post.json; `asked`: the user asked it to write one just now.
  const [fromAgent, setFromAgent] = useState(false);
  const [asked, setAsked] = useState(false);
  const [later, setLater] = useState(false);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [phase, setPhase] = useState<Phase>({ kind: 'form' });
  const [error, setError] = useState<CloudErrorCode | null>(null);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [details, setDetails] = useState<PostDetails | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setHybridError('');
    setTiktokSettings(undefined);
    setMedia(null);
    setDetails(null);
    setTitle(project.title);
    setCaption(project.title);
    setFromAgent(false);
    setAsked(false);
    const slot = defaultSlot(project.scheduledAt);
    setDate(dateValue(slot));
    setTime(timeValue(slot));
    setLater(!!project.scheduledAt && new Date(project.scheduledAt).getTime() > Date.now());
    setRequestId(crypto.randomUUID());
    setPhase({ kind: 'form' });
    let alive = true;
    void mediaProbe(project.id).then((info) => alive && setMedia(info)).catch(() => {});
    socialAccounts()
      .then((list) => {
        if (!alive) return;
        const usable = list.filter((a) => a.status === 'connected');
        setAccounts(usable);
        setPicked(new Set(usable.map((a) => a.id)));
      })
      .catch((e) => alive && (setAccounts([]), setError(cloudErrorCode(e))));
    void readPostDraft(project.id).then((d) => alive && d && fill(d));
    // A video posted before: show how it went.
    if (project.socialPostId) {
      socialPostStatus(project.socialPostId)
        .then((d) => alive && setDetails(d))
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
  }, [open, project.id, project.title, project.scheduledAt, project.socialPostId]);

  /** The agent's draft into the fields; the user reads and edits them before posting. */
  function fill(d: PostDraft) {
    if (d.title) setTitle(d.title);
    setCaption(captionOf(d) || d.title);
    if (d.scheduledAt) {
      const when = new Date(d.scheduledAt);
      setLater(true);
      setDate(dateValue(when));
      setTime(timeValue(when));
    }
    setFromAgent(true);
  }

  // The agent's turn for "write it with AI" ended: read what it wrote. It ends only after it started:
  // right after the ask, the turn may not be running yet.
  const started = useRef(false);
  useEffect(() => {
    if (asked && agentBusy) started.current = true;
  }, [asked, agentBusy]);
  useEffect(() => {
    if (!open || !asked || agentBusy || !started.current) return;
    started.current = false;
    let alive = true;
    void readPostDraft(project.id).then((d) => {
      if (!alive) return;
      setAsked(false);
      if (d) fill(d);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, asked, agentBusy, project.id]);

  const askAgent = () => {
    if (!onAskAgent || agentBusy) return;
    started.current = false;
    setAsked(true);
    onAskAgent();
    track('post draft asked');
  };
  const writing = asked && agentBusy;

  const at = later ? localToIso(date, time) : null;
  const youtubeSelected = accounts?.some(a => a.platform === 'youtube' && picked.has(a.id)) ?? false;
  const shortsFormat = isShortsFormat(media);
  const tiktokAccount = accounts?.find(a => a.id.startsWith('z:') && a.platform === 'tiktok' && picked.has(a.id));
  const canPost = (!tiktokAccount || !!tiktokSettings) && phase.kind === 'form' && picked.size > 0 && caption.trim().length > 0 && (!later || !!at);

  const post = async () => {
    setError(null);
    setHybridError('');
    setPhase({ kind: 'posting' });
    try {
      const result = await socialPost({ projectId: project.id, title: (!hybrid || youtubeSelected) ? title.trim() || null : null, caption: caption.trim(), accountIds: [...picked], scheduledAt: at, clientRequestId: requestId, ...(hybrid ? {tiktokSettings,youtubePrivacy,youtubeMadeForKids:kids} : {}) });
      setPhase({ kind: 'done', result });
      track('video posted', {
        accounts: picked.size,
        scheduled: result.status === 'scheduled',
        platforms: [...new Set((accounts ?? []).filter((a) => picked.has(a.id)).map((a) => a.platform))].sort().join(','),
      });
      const fresh = (await listProjects().catch(() => [])).find((p) => p.id === project.id);
      if (fresh) onPosted(fresh);
      useApp.getState().bumpProjects();
      socialPostStatus(result.postId)
        .then(setDetails)
        .catch(() => {});
    } catch (e) {
      // The same request id stays for the retry: a post that did go out is found, not made again.
      if(hybrid) {
        setHybridError(String(e));
        void socialPostStatus(`hybrid:${project.id}`).then(setDetails).catch(()=>{});
        useApp.getState().bumpProjects();
      } else setError(cloudErrorCode(e));
      track('video post failed', { error: cloudErrorCode(e) });
      setPhase({ kind: 'form' });
    }
  };

  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const accountName = (id: string) => {
    const a = accounts?.find((x) => x.id === id);
    return a ? (a.username ? `@${a.username}` : platformName(a.platform)) : id;
  };

  return (
    <Dialog open={open} onOpenChange={(o) => phase.kind !== 'posting' && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('post.title')}</DialogTitle>
          <DialogDescription>{t('post.description')}</DialogDescription>
        </DialogHeader>

        {phase.kind === 'done' ? (
          <p role="status" className="m-0 text-sm">
            {hybrid ? (t('hybrid.requestSaved')) : phase.result.status === 'scheduled'
              ? t('post.scheduled', { count: phase.result.postsCharged })
              : t('post.posted', { count: phase.result.postsCharged })}
            {!hybrid && <span className="block pt-1 text-xs text-text-3">{t('post.postsLeft', { count: phase.result.usage.remaining })}</span>}
          </p>
        ) : accounts === null ? (
          <p role="status" className="m-0 flex items-center gap-2 text-xs text-text-3">
            <Spinner size={12} />
            {t('post.loading')}
          </p>
        ) : accounts.length === 0 && !error ? (
          <div className="flex flex-col items-start gap-3">
            <p className="m-0 text-sm text-text-2">{t('post.noAccounts')}</p>
            <Button
              variant="secondary"
              onClick={() => {
                onOpenChange(false);
                navigate({ name: hybrid ? 'social' : 'settings' });
              }}
            >
              {t('post.connectFirst')}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
              <legend className="pb-2 text-[13px] text-text-2">{t('post.to')}</legend>
              {accounts.map((a) => (
                <label key={a.id} className="flex cursor-pointer items-center gap-3 text-[13px]">
                  <Checkbox checked={picked.has(a.id)} onCheckedChange={() => toggle(a.id)} />
                  <PlatformLogo platform={a.platform} size={18} />
                  <span className="min-w-0 flex-1 truncate">{a.username ? `@${a.username}` : platformName(a.platform)}</span>
                  <span className="text-xs text-text-3">{platformName(a.platform)}</span>
                </label>
              ))}
            </fieldset>
            {hybrid && <p className="m-0 text-xs text-text-3">{t('post.multiPlatformHint')}</p>}
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <span className="mr-auto text-xs text-text-3">
                  {writing ? (
                    <span role="status" className="inline-flex items-center gap-2">
                      <Spinner size={12} />
                      {t('post.agentWriting')}
                    </span>
                  ) : fromAgent ? (
                    t('post.fromAgent')
                  ) : null}
                </span>
                {onAskAgent && (
                  <Button variant="secondary" className="h-7 px-2.5 text-xs" disabled={agentBusy} onClick={askAgent}>
                    <Sparkles size={13} aria-hidden="true" className="text-orange-light" />
                    {t('post.writeWithAi')}
                  </Button>
                )}
              </div>
              {(!hybrid || youtubeSelected) && <label className="flex flex-col gap-1.5 text-[13px] text-text-2">
                <span className="flex justify-between">
                  {hybrid ? t('post.youtubeTitle') : t('post.titleField')}
                  <span className="text-xs text-text-3 tabular-nums">{title.length}/{TITLE_MAX}</span>
                </span>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={TITLE_MAX} disabled={writing} />
              </label>}
              <label className="flex flex-col gap-1.5 text-[13px] text-text-2">
                {hybrid ? t('post.captionHashtags') : t('post.caption')}
                <Textarea value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={2200} rows={4} disabled={writing} />
              </label>
              {hybrid && <p className="m-0 text-xs text-text-3">{t('post.captionRouting')}</p>}
            </div>
            <div className="flex flex-col gap-2">
              <label className="flex cursor-pointer items-center gap-3 text-[13px]">
                <Checkbox checked={later} onCheckedChange={(v) => setLater(v === true)} />
                {t('post.later')}
              </label>
              {later && (
                <div className="flex gap-2">
                  <Input type="date" aria-label={t('post.date')} value={date} onChange={(e) => setDate(e.target.value)} />
                  <Input type="time" aria-label={t('post.time')} value={time} onChange={(e) => setTime(e.target.value)} />
                </div>
              )}
            </div>
            {tiktokAccount && <TikTokOptions key={tiktokAccount.id} accountId={tiktokAccount.id} contentKey={`${title}\n${caption}`} onChange={setTiktokSettings}/> }
            {hybrid && picked.has('yt:own') && <fieldset className="flex flex-col gap-2 rounded-md border border-border p-3 text-sm"><legend>YouTube</legend>
              {media && <p className="m-0 text-xs text-text-2">{t(shortsFormat ? 'post.shortsEligible' : 'post.shortsIneligible', { width: media.width, height: media.height, seconds: Math.round(media.durationSec) })}</p>}
              <label className="flex flex-col gap-1">{t('hybrid.youtubePrivacy')}<select className="rounded border border-border bg-card p-2" value={youtubePrivacy} onChange={e=>setYoutubePrivacy(e.target.value)}><option value="private">{t('hybrid.private')}</option><option value="unlisted">{t('hybrid.unlisted')}</option><option value="public">{t('hybrid.public')}</option></select></label>
              {later && <p className="m-0 text-xs text-text-2">{t('hybrid.scheduleHint')}</p>}
              <label className="flex items-center gap-2"><input type="checkbox" checked={kids} onChange={e=>setKids(e.target.checked)}/>{t('hybrid.kids')}</label>
            </fieldset>}
            <p className="m-0 text-xs text-text-3">{hybrid ? (t('hybrid.ownAccounts')) : t('post.cost', { count: picked.size })}</p>
          </div>
        )}

        {details && details.results.length > 0 && (
          <ul aria-label={t('post.results')} className="m-0 flex list-none flex-col gap-1 border-t border-hairline p-0 pt-3">
            {details.results.map((r) => (
              <li key={r.socialAccountId} className="flex items-center gap-2 text-[13px]">
                <span className="min-w-0 flex-1 truncate">{accountName(r.socialAccountId)}</span>
                {r.success ? (
                  r.url ? (
                    <a href={shortsFormat && r.socialAccountId === 'yt:own' ? shortsPlayerUrl(r.url) ?? r.url : r.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-orange-light">
                      {t(shortsFormat && r.socialAccountId === 'yt:own' && shortsPlayerUrl(r.url) ? 'post.openShorts' : 'post.open')}
                      <ExternalLink size={12} aria-hidden="true" />
                    </a>
                  ) : (
                    <span className="text-text-2">{t('post.ok')}</span>
                  )
                ) : (
                  <span className="text-orange-light" title={r.error ?? undefined}>
                    {t('post.failed')}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}

        {hybridError && <p role="alert" className="m-0 text-sm text-orange-light">{hybridError}</p>}
        {error && (
          <div role="alert" className="flex flex-wrap items-center gap-3 text-xs text-orange-light">
            {explain(error)}
            {(error === 'plan-required' || error === 'quota-exceeded') && (
              <Button
                variant="secondary"
                className="h-7 px-2 text-xs"
                onClick={() => {
                  onOpenChange(false);
                  navigate({ name: 'plans', from: 'settings' });
                }}
              >
                {t('cloud.seePlans')}
              </Button>
            )}
          </div>
        )}

        <DialogFooter>
          {phase.kind === 'done' ? (
            <Button onClick={() => onOpenChange(false)}>{t('post.close')}</Button>
          ) : (
            <>
              <Button variant="ghost" disabled={phase.kind === 'posting'} onClick={() => onOpenChange(false)}>
                {t('post.cancel')}
              </Button>
              <Button disabled={!canPost} onClick={() => void post()}>
                {phase.kind === 'posting' && <Spinner className="text-current" />}
                {phase.kind === 'posting' ? t('post.posting') : later ? t('post.schedule') : t('post.postNow')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
