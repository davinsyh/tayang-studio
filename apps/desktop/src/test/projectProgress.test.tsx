import { act, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import type { AgentUpdate, FileInfo, Job, Project, ProjectStatus } from '@tayang/shared';

vi.mock('@/lib/ipc', () => ({
  getChat: vi.fn().mockResolvedValue(null),
  listMessages: vi.fn().mockResolvedValue([]),
  addMessage: vi.fn().mockResolvedValue(null),
  agentStart: vi.fn().mockResolvedValue(undefined),
  agentPrompt: vi.fn().mockResolvedValue(undefined),
  agentCancel: vi.fn(),
  agentStop: vi.fn().mockResolvedValue(undefined),
  agentRespondPermission: vi.fn(),
  upsertJob: vi.fn().mockResolvedValue(undefined),
  listJobs: vi.fn().mockResolvedValue([]),
  latestRenderInfo: vi.fn().mockResolvedValue(null),
  newestVideoInfo: vi.fn().mockResolvedValue(null),
  setProjectStatus: vi.fn(),
  mediaProbe: vi.fn().mockResolvedValue({ durationSec: 12, fps: 30, frames: 360, width: 1080, height: 1920 }),
  recentImages: vi.fn().mockResolvedValue([]),
  assetUrl: (p: string) => p,
}));
const updates: ((e: { chatId: string; update: AgentUpdate }) => void)[] = [];
vi.mock('@/lib/events', () => ({
  onQuestion: vi.fn(async () => () => {}),
  onAgentAction: vi.fn(async () => () => {}),
  onAgentUpdate: vi.fn(async (cb: (e: { chatId: string; update: AgentUpdate }) => void) => {
    updates.push(cb);
    return () => {};
  }),
  onPermission: vi.fn(async () => () => {}),
}));

import { agentPrompt, latestRenderInfo, listJobs, newestVideoInfo, setProjectStatus, upsertJob } from '@/lib/ipc';
import { renderTiming } from '@/lib/renderCheck';
import { taskWaitTiming } from '@/lib/agentTaskWait';
import { resetLateRenders, settleLateRenders } from '@/lib/buildJobs';
import { useChat } from '@/state/chat';
import { useRender } from '@/state/render';
import { isRenderTool } from '@/lib/renderTool';
import { MessageList } from '@/components/MessageList';

const emit = (chatId: string, update: AgentUpdate) => act(async () => updates.forEach((cb) => cb({ chatId, update })));
const proj = (id: string, status: ProjectStatus): Project => ({
  id, title: id, slug: id, folder: `/w/${id}`, kind: 'explainer', format: '9:16', language: 'id', status,
  styleId: null, scheduledAt: null, reviewState: 'none', postedAt: null, remindedAt: null, reviewRemindedAt: null,
  durationSec: null, createdAt: 'c', updatedAt: 'u',
});
const video = (at: Date, size = 10): FileInfo => ({ path: '/w/p1/renders/v.mp4', name: 'v.mp4', size, modifiedAt: at.toISOString() });
const job = { projectId: 'p1', title: 'Jalur Rempah' };
const tool = (toolCallId: string, toolKind: 'edit' | 'read' | 'execute' | 'delete' | 'move', status: 'running' | 'done' | 'failed'): AgentUpdate => ({
  kind: 'tool', toolCallId, title: `${toolKind} something`, status, toolKind,
});
const statusCalls = () => vi.mocked(setProjectStatus).mock.calls.map(([id, s]) => `${id}:${s}`);

beforeEach(() => {
  vi.clearAllMocks();
  renderTiming.stableMs = 0;
  vi.mocked(latestRenderInfo).mockResolvedValue(null);
  vi.mocked(setProjectStatus).mockImplementation(async (id, status) => proj(id, status));
  updates.length = 0;
  useChat.getState().reset();
  useChat.getState().listen();
  resetLateRenders();
});

describe("a project's status follows its chat", () => {
  it('becomes building when the first edit, delete, move or command finishes, not on reads or failures', async () => {
    await useChat.getState().send('c1', [{ type: 'text', text: 'go' }], { agentId: 'claude', job });
    await emit('c1', tool('t1', 'read', 'done'));
    await emit('c1', tool('t2', 'edit', 'running'));
    await emit('c1', tool('t3', 'execute', 'failed'));
    expect(setProjectStatus).not.toHaveBeenCalled();
    await emit('c1', tool('t2', 'edit', 'done'));
    await waitFor(() => expect(statusCalls()).toEqual(['p1:building']));
    // Once building, later work asks nothing more.
    await emit('c1', tool('t4', 'move', 'done'));
    await emit('c1', tool('t5', 'delete', 'done'));
    expect(statusCalls()).toEqual(['p1:building']);
  });

  it('a chat without a project never moves a status', async () => {
    await useChat.getState().send('c2', [{ type: 'text', text: 'go' }], { agentId: 'claude' });
    await emit('c2', tool('t1', 'edit', 'done'));
    await act(async () => {});
    expect(setProjectStatus).not.toHaveBeenCalled();
  });

  it('becomes rendered when the turn ends with a finished render', async () => {
    await useChat.getState().send('c1', [{ type: 'text', text: 'go' }], { agentId: 'claude', job });
    vi.mocked(latestRenderInfo).mockResolvedValue(video(new Date(Date.now() + 500)));
    await emit('c1', { kind: 'done', stopReason: 'end_turn' });
    await waitFor(() => expect(statusCalls()).toContain('p1:rendered'));
  });

  it('stays where it is when the turn ends without a video', async () => {
    await useChat.getState().send('c1', [{ type: 'text', text: 'go' }], { agentId: 'claude', job });
    await emit('c1', { kind: 'done', stopReason: 'end_turn' });
    await act(async () => {});
    expect(setProjectStatus).not.toHaveBeenCalled();
  });

  it('becomes rendered when a late render settles its build job', async () => {
    const waiting: Job = {
      id: 'build-c9', kind: 'build', title: 'Kopi', projectId: 'p9', chatId: 'c9', agentId: 'claude', status: 'needs-you',
      progress: null, note: 'No video yet', sourceUrl: null, renderBaselineAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z',
    };
    vi.mocked(listJobs).mockResolvedValue([waiting]);
    vi.mocked(latestRenderInfo).mockResolvedValue(video(new Date('2026-11-02T00:00:00.000Z')));
    await settleLateRenders(Date.parse('2026-11-03T00:00:00.000Z'), [waiting]);
    await waitFor(() => expect(statusCalls()).toEqual(['p9:rendered']));
  });
});

describe('Antigravity render continuation', () => {
  const timing = { ...taskWaitTiming };
  const renderTool: AgentUpdate = { kind: 'tool', toolCallId: 'render-1', title: 'ffmpeg -i input.mp4 renders/final.mp4', status: 'running', toolKind: 'execute' };

  beforeEach(() => {
    Object.assign(taskWaitTiming, { pollMs: 10, noOutputMs: 100, stalledMs: 100, maxMs: 500, incompleteMs: 10 });
  });
  afterEach(() => Object.assign(taskWaitTiming, timing));

  it('waits for a verified render, then continues the same agent session once', async () => {
    await useChat.getState().send('c1', [{ type: 'text', text: 'render it' }], { agentId: 'antigravity', job });
    await emit('c1', renderTool);
    await emit('c1', { ...renderTool, status: 'done' });
    await emit('c1', { kind: 'done', stopReason: 'end_turn' });
    expect(useChat.getState().streaming.c1).toBe(true);
    expect(agentPrompt).toHaveBeenCalledTimes(1);

    vi.mocked(latestRenderInfo).mockResolvedValue(video(new Date(Date.now() + 500)));
    await waitFor(() => expect(agentPrompt).toHaveBeenCalledTimes(2));
    expect(vi.mocked(agentPrompt).mock.calls[1]![1][0]).toMatchObject({ type: 'text', text: expect.stringContaining('verified that the render finished') });
    await emit('c1', { kind: 'done', stopReason: 'end_turn' });
    expect(useChat.getState().streaming.c1).toBe(false);
    expect(agentPrompt).toHaveBeenCalledTimes(2);
  });

  it('does not continue when the render was already complete at the turn end', async () => {
    await useChat.getState().send('c1', [{ type: 'text', text: 'render it' }], { agentId: 'antigravity', job });
    await emit('c1', renderTool);
    vi.mocked(latestRenderInfo).mockResolvedValue(video(new Date(Date.now() + 500)));
    await emit('c1', { kind: 'done', stopReason: 'end_turn' });
    await waitFor(() => expect(useChat.getState().streaming.c1).toBe(false));
    expect(agentPrompt).toHaveBeenCalledTimes(1);
  });

  it('asks the same agent to inspect an ended render that produced no video', async () => {
    await useChat.getState().send('c1', [{ type: 'text', text: 'render it' }], { agentId: 'antigravity', job });
    await emit('c1', renderTool);
    await emit('c1', { ...renderTool, status: 'done' });
    await emit('c1', { kind: 'done', stopReason: 'end_turn' });
    await waitFor(() => expect(agentPrompt).toHaveBeenCalledTimes(2));
    expect(vi.mocked(agentPrompt).mock.calls[1]![1][0]).toMatchObject({ type: 'text', text: expect.stringContaining('without a verified final video') });
    await emit('c1', { kind: 'done', stopReason: 'end_turn' });
    expect(useChat.getState().streaming.c1).toBe(false);
    expect(agentPrompt).toHaveBeenCalledTimes(2);
  });

  it('keeps waiting if the resumed agent starts a render on its next turn', async () => {
    await useChat.getState().send('c1', [{ type: 'text', text: 'render it' }], { agentId: 'antigravity', job });
    await emit('c1', renderTool);
    await emit('c1', { ...renderTool, status: 'done' });
    await emit('c1', { kind: 'done', stopReason: 'end_turn' });
    await waitFor(() => expect(agentPrompt).toHaveBeenCalledTimes(2));
    await emit('c1', { ...renderTool, toolCallId: 'render-2' });
    await emit('c1', { ...renderTool, toolCallId: 'render-2', status: 'done' });
    await emit('c1', { kind: 'done', stopReason: 'end_turn' });
    expect(useChat.getState().streaming.c1).toBe(true);
    vi.mocked(latestRenderInfo).mockResolvedValue(video(new Date(Date.now() + 500)));
    await waitFor(() => expect(agentPrompt).toHaveBeenCalledTimes(3));
    await emit('c1', { kind: 'done', stopReason: 'end_turn' });
    expect(useChat.getState().streaming.c1).toBe(false);
  });

  it('stops waiting when the user cancels', async () => {
    await useChat.getState().send('c1', [{ type: 'text', text: 'render it' }], { agentId: 'antigravity', job });
    await emit('c1', renderTool);
    await emit('c1', { kind: 'done', stopReason: 'end_turn' });
    await useChat.getState().cancel('c1');
    vi.mocked(latestRenderInfo).mockResolvedValue(video(new Date(Date.now() + 500)));
    expect(useChat.getState().streaming.c1).toBe(false);
    expect(agentPrompt).toHaveBeenCalledTimes(1);
  });

  it('does not continue a preview-only request', async () => {
    await useChat.getState().send('c1', [{ type: 'text', text: 'jangan render dulu, lihat preview dulu' }], { agentId: 'antigravity', job });
    await emit('c1', renderTool);
    await emit('c1', { kind: 'done', stopReason: 'end_turn' });
    expect(useChat.getState().streaming.c1).toBe(false);
    expect(agentPrompt).toHaveBeenCalledTimes(1);
  });

  it('continues once when a pending ACP tool reports completion after end_turn', async () => {
    await useChat.getState().send('c1', [{ type: 'text', text: 'finish the files' }], { agentId: 'antigravity' });
    await emit('c1', { kind: 'tool', toolCallId: 'task-1', title: 'Create assets', status: 'running', toolKind: 'other' });
    await emit('c1', { kind: 'done', stopReason: 'end_turn' });
    expect(useChat.getState().streaming.c1).toBe(true);
    await emit('c1', { kind: 'tool', toolCallId: 'task-1', title: 'Create assets', status: 'done', toolKind: 'other' });
    await waitFor(() => expect(agentPrompt).toHaveBeenCalledTimes(2));
    await emit('c1', { kind: 'done', stopReason: 'end_turn' });
    expect(useChat.getState().streaming.c1).toBe(false);
  });

  it('does not resume an observable task after the user stops waiting', async () => {
    await useChat.getState().send('c1', [{ type: 'text', text: 'finish the files' }], { agentId: 'antigravity' });
    await emit('c1', { kind: 'tool', toolCallId: 'task-1', title: 'Create assets', status: 'running', toolKind: 'other' });
    await emit('c1', { kind: 'done', stopReason: 'end_turn' });
    await useChat.getState().cancel('c1');
    await emit('c1', { kind: 'tool', toolCallId: 'task-1', title: 'Create assets', status: 'done', toolKind: 'other' });
    expect(agentPrompt).toHaveBeenCalledTimes(1);
    expect(useChat.getState().streaming.c1).toBe(false);
  });

  it('continues a reply that explicitly says the work is still in progress', async () => {
    await useChat.getState().send('c1', [{ type: 'text', text: 'fix the video' }], { agentId: 'antigravity', job });
    await emit('c1', { kind: 'text', text: 'Masih memproses 7 cuplikan adegan, harap tunggu sebentar.' });
    await emit('c1', { kind: 'done', stopReason: 'end_turn' });
    expect(useChat.getState().streaming.c1).toBe(true);
    await waitFor(() => expect(agentPrompt).toHaveBeenCalledTimes(2));
    await emit('c1', { kind: 'text', text: 'Selesai. Semua cuplikan sudah diperbaiki.' });
    await emit('c1', { kind: 'done', stopReason: 'end_turn' });
    expect(useChat.getState().streaming.c1).toBe(false);
    expect(agentPrompt).toHaveBeenCalledTimes(2);
  });

  it('respects Stop while waiting to continue an unfinished reply', async () => {
    await useChat.getState().send('c1', [{ type: 'text', text: 'fix the video' }], { agentId: 'antigravity', job });
    await emit('c1', { kind: 'text', text: 'Sedang menyusun cuplikan, mohon tunggu.' });
    await emit('c1', { kind: 'done', stopReason: 'end_turn' });
    await useChat.getState().cancel('c1');
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(agentPrompt).toHaveBeenCalledTimes(1);
    expect(useChat.getState().streaming.c1).toBe(false);
  });

  it('lets the agent finish when it asks for the user to review a preview', async () => {
    await useChat.getState().send('c1', [{ type: 'text', text: 'show a preview first' }], { agentId: 'antigravity', job });
    await emit('c1', { kind: 'text', text: 'Preview sudah siap. Apakah tampilannya sesuai?' });
    await emit('c1', { kind: 'done', stopReason: 'end_turn' });
    expect(useChat.getState().streaming.c1).toBe(false);
    expect(agentPrompt).toHaveBeenCalledTimes(1);
  });

  it('stops automatic continuations after six unfinished replies', async () => {
    await useChat.getState().send('c1', [{ type: 'text', text: 'finish the video' }], { agentId: 'antigravity', job });
    for (let i = 0; i < 6; i++) {
      await emit('c1', { kind: 'text', text: 'Masih memproses, harap tunggu sebentar.' });
      await emit('c1', { kind: 'done', stopReason: 'end_turn' });
      await waitFor(() => expect(agentPrompt).toHaveBeenCalledTimes(i + 2));
    }
    await emit('c1', { kind: 'text', text: 'Masih memproses, harap tunggu sebentar.' });
    await emit('c1', { kind: 'done', stopReason: 'end_turn' });
    expect(useChat.getState().streaming.c1).toBe(false);
    expect(agentPrompt).toHaveBeenCalledTimes(7);
  });
});

describe('a render inside a pipeline command is seen by its file', () => {
  const T0 = Date.parse('2026-11-04T10:00:00.000Z');
  /** The owner's screenshot: the template's whole pipeline (voice, then render) in one command. */
  const PIPELINE = 'cd ~/Tayang/jalur-rempah-1a2b && npm run make -- --run runs/jalur-rempah 2>&1 | tail -40';
  const mp4 = (size: number, at: number): FileInfo => ({
    path: '/w/p1/runs/jalur-rempah/out/final.mp4', name: 'final.mp4', size, modifiedAt: new Date(at).toISOString(),
  });
  const run = () => useRender.getState().runs.p1;
  const polls = () => vi.mocked(newestVideoInfo).mock.calls.length;
  const tick = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
  const start = async (title = PIPELINE, toolKind: 'execute' | 'edit' = 'execute', opts: object = { job }) => {
    await useChat.getState().send('c1', [{ type: 'text', text: 'render it' }], { agentId: 'claude', ...opts });
    await emit('c1', { kind: 'tool', toolCallId: 't1', title, status: 'running', toolKind });
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    vi.mocked(newestVideoInfo).mockResolvedValue(null);
    useRender.setState({ runs: {} });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('the screenshot pipeline shows "Rendering video" once its mp4 appears, until it stops changing for 15 s', async () => {
    expect(isRenderTool(PIPELINE, null)).toBe(false);
    await start();
    await tick(3000);
    expect(polls()).toBe(1);
    expect(newestVideoInfo).toHaveBeenCalledWith('p1');
    expect(run()).toBeUndefined();
    // An mp4 from before the turn is not this render.
    vi.mocked(newestVideoInfo).mockResolvedValue(mp4(5000, T0 - 60_000));
    await tick(3000);
    expect(run()).toBeUndefined();
    // The voice is done and the render starts writing.
    vi.mocked(newestVideoInfo).mockImplementation(async () => mp4(100, Date.now()));
    await tick(3000);
    expect(run()).toMatchObject({ source: 'agent', chatId: 'c1', toolCallId: 't1' });
    expect(vi.mocked(upsertJob).mock.calls.at(-1)![0]).toMatchObject({ status: 'working', note: 'Rendering video' });
    render(<MessageList messages={useChat.getState().messages.c1!} streaming />);
    expect(screen.getByTestId('activity-running')).toHaveTextContent(/Rendering video/);
    // It keeps growing.
    let size = 100;
    vi.mocked(newestVideoInfo).mockImplementation(async () => mp4((size += 1000), Date.now()));
    await tick(9000);
    expect(run()).toBeDefined();
    // It stops changing: 15 s later the render is over, while the command goes on.
    vi.mocked(newestVideoInfo).mockResolvedValue(mp4(size + 1000, Date.now()));
    await tick(12_000);
    expect(run()).toBeDefined();
    await tick(6000);
    expect(run()).toBeUndefined();
    expect(vi.mocked(upsertJob).mock.calls.at(-1)![0]).toMatchObject({ status: 'working', note: null });
    // The command ends: no more looks.
    await emit('c1', { kind: 'tool', toolCallId: 't1', title: PIPELINE, status: 'done', toolKind: 'execute' });
    const after = polls();
    await tick(9000);
    expect(polls()).toBe(after);
  });

  it('a growing file counts even when its time is older than 10 s; the render ends with its command', async () => {
    await start();
    // Written during the turn, but 30 s ago: not on its own.
    vi.setSystemTime(T0 + 30_000);
    vi.mocked(newestVideoInfo).mockResolvedValue(mp4(100, T0 + 1000));
    await tick(3000);
    expect(run()).toBeUndefined();
    // Same time (a coarse file system), but bigger than at the last look.
    vi.mocked(newestVideoInfo).mockResolvedValue(mp4(900, T0 + 1000));
    await tick(3000);
    expect(run()).toBeDefined();
    await emit('c1', { kind: 'tool', toolCallId: 't1', title: PIPELINE, status: 'done', toolKind: 'execute' });
    expect(run()).toBeUndefined();
  });

  it('a render that just finished (or was just copied to renders/) is not taken for a new one by the next command', async () => {
    // Written 2 s before an unrelated 6 s command (a frame check, a lint) starts.
    vi.mocked(newestVideoInfo).mockResolvedValue(mp4(5000, T0 - 2000));
    await start('npm run lint');
    await tick(6000);
    expect(polls()).toBe(2);
    expect(run()).toBeUndefined();
    // A real change after the first look still counts.
    vi.mocked(newestVideoInfo).mockResolvedValue(mp4(9000, Date.now()));
    await tick(3000);
    expect(run()).toBeDefined();
  });

  it('one look at a time: a slow look is never doubled', async () => {
    vi.mocked(newestVideoInfo).mockReturnValue(new Promise(() => {}));
    await start();
    await tick(12_000);
    expect(polls()).toBe(1);
  });

  it('stops looking when the turn ends', async () => {
    await start();
    await tick(3000);
    await emit('c1', { kind: 'done', stopReason: 'end_turn' });
    const after = polls();
    await tick(9000);
    expect(polls()).toBe(after);
  });

  it('never looks for edits or for chats without a video', async () => {
    await start('Edit scenes.ts', 'edit');
    await tick(9000);
    expect(newestVideoInfo).not.toHaveBeenCalled();
    useChat.getState().reset();
    useChat.getState().listen();
    await start(PIPELINE, 'execute', {});
    await tick(9000);
    expect(newestVideoInfo).not.toHaveBeenCalled();
  });

  it('a command the render check already knows is not looked at again', async () => {
    await start('npx hyperframes render --output renders/a.mp4');
    expect(run()).toBeDefined();
    await tick(9000);
    expect(newestVideoInfo).not.toHaveBeenCalled();
  });
});
