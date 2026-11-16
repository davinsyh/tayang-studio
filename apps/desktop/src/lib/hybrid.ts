import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
export interface HybridSettings {
  enabled: boolean;
  profileId: string;
  clientId: string;
  hasZernioKey: boolean;
  youtubeConnected: boolean;
  youtubeName?: string;
}
export const useHybrid = create<{
  settings: HybridSettings | null;
  refresh(): Promise<void>;
}>((set) => ({
  settings: null,
  async refresh() {
    try {
      set({ settings: await invoke<HybridSettings>("hybrid_settings") });
    } catch {
      /* Older hosts retain cloud publishing. */
    }
  },
}));
export const hybridSave = (o: {
  enabled: boolean;
  profileId: string;
  clientId: string;
  apiKey?: string;
  clientSecret?: string;
}) => invoke<void>("hybrid_save", o);
export const youtubeConnect = () => invoke<void>("hybrid_youtube_connect");
export interface CreatorInfo {
  privacyLevels: { value: string; label: string }[];
  postingLimits: { interactionSettings: Record<string, { enabled: boolean }> };
}
export const creatorInfo = (accountId: string) =>
  invoke<CreatorInfo>("hybrid_creator", { accountId });
