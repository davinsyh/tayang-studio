import type { FileInfo } from '@tayang/shared';
import { newestVideoInfo } from '@/lib/ipc';
import { finishedRender, renderedSince } from '@/lib/renderCheck';

export const taskWaitTiming = {
  pollMs: 5000,
  noOutputMs: 180_000,
  stalledMs: 180_000,
  maxMs: 30 * 60_000,
  incompleteMs: 15_000,
};

/** A reply that explicitly says work is still in progress is a yield, not a final result. */
export function unfinishedAgentReply(text: string): boolean {
  const tail = text.trim().slice(-700);
  return /(?:\b(?:masih|sedang)\s+(?:memproses|mengerjakan|menjalankan|merender|rendering|menyusun|menunggu|menghasilkan|memperbarui|mengambil|mengedit|membuat|memasang|menyiapkan|menyelesaikan)\b|\bbelum\s+selesai\b|\b(?:harap|mohon)\s+tunggu\b|\b(?:saya\s+akan|akan\s+saya)\s+(?:lanjutkan|membuat|merender|memproses|menyelesaikan|menyiapkan|memperbarui|mengecek)\b|\b(?:still\s+(?:working|processing|rendering|running)|please\s+wait|work\s+in\s+progress|i(?:'ll|\s+will)\s+(?:continue|render|finish|check))\b)/i.test(tail);
}

export type RenderWaitResult =
  | { kind: 'finished'; file: FileInfo }
  | { kind: 'no-output' | 'stalled' | 'timeout' | 'aborted' };

function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });
}

/** Wait for a verified video, not just an ACP turn or tool marked complete. */
export async function waitForRenderTask(projectId: string, since: number, signal: AbortSignal): Promise<RenderWaitResult> {
  const began = Date.now();
  let outputSeen = false;
  let lastSignature = '';
  let changedAt = began;
  while (!signal.aborted) {
    const file = await finishedRender(projectId, since);
    if (signal.aborted) break;
    if (file) return { kind: 'finished', file };
    const newest = await newestVideoInfo(projectId).catch(() => null);
    if (signal.aborted) break;
    if (renderedSince(newest, since)) {
      outputSeen = true;
      const signature = `${newest!.path}\0${newest!.size}\0${newest!.modifiedAt}`;
      if (signature !== lastSignature) {
        lastSignature = signature;
        changedAt = Date.now();
      }
    }
    const elapsed = Date.now() - began;
    if (!outputSeen && elapsed >= taskWaitTiming.noOutputMs) return { kind: 'no-output' };
    if (outputSeen && Date.now() - changedAt >= taskWaitTiming.stalledMs) return { kind: 'stalled' };
    if (elapsed >= taskWaitTiming.maxMs) return { kind: 'timeout' };
    await delay(taskWaitTiming.pollMs, signal);
  }
  return { kind: 'aborted' };
}
