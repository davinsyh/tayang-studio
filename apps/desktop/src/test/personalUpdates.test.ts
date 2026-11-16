import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/plugin-updater', () => ({ check: vi.fn() }));
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: vi.fn() }));

import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { startUpdateChecks, useUpdater } from '@/state/updater';

describe('personal distribution updates', () => {
  it('never contacts the release feed or installs an update, even on explicit requests', async () => {
    vi.useFakeTimers();
    const stop = startUpdateChecks(false);
    try {
      await useUpdater.getState().check();
      await useUpdater.getState().download();
      await useUpdater.getState().restart();
      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
      expect(check).not.toHaveBeenCalled();
      expect(relaunch).not.toHaveBeenCalled();
    } finally {
      stop();
      vi.useRealTimers();
    }
  });
});
