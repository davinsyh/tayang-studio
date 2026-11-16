import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
import { invoke } from "@tauri-apps/api/core";
import { HybridSettingsPanel } from "@/components/HybridSettings";
import { TikTokOptions } from "@/components/HybridPostOptions";
import { useHybrid } from "@/lib/hybrid";
beforeEach(() => {
  vi.mocked(invoke).mockReset();
  useHybrid.setState({ settings: null });
});
it("saves secrets without echoing them back and clears inputs after save", async () => {
  vi.mocked(invoke).mockImplementation(async (command) =>
    command === "hybrid_settings"
      ? {
          enabled: true,
          profileId: "012345678901234567890123",
          clientId: "desktop.apps.googleusercontent.com",
          hasZernioKey: true,
          youtubeConnected: false,
        }
      : undefined,
  );
  render(<HybridSettingsPanel />);
  const user = userEvent.setup();
  await waitFor(() =>
    expect(screen.getByLabelText("Zernio Profile ID")).toHaveValue(
      "012345678901234567890123",
    ),
  );
  const key = screen.getByLabelText("Zernio API key");
  await user.type(key, "test-only-key");
  await user.click(screen.getByRole("button", { name: "Save settings" }));
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith(
      "hybrid_save",
      expect.objectContaining({ apiKey: "test-only-key", enabled: true }),
    ),
  );
  expect(key).toHaveValue("");
  expect(screen.queryByText("test-only-key")).not.toBeInTheDocument();
});
it("requires creator privacy selection and explicit per-video TikTok consent", async () => {
  vi.mocked(invoke).mockResolvedValue({
    privacyLevels: [{ value: "SELF_ONLY", label: "Self Only" }],
    postingLimits: {
      interactionSettings: {
        allow_comment: { enabled: true },
        allow_duet: { enabled: false },
        allow_stitch: { enabled: false },
      },
    },
  });
  const changed = vi.fn();
  render(<TikTokOptions accountId="z:abc" onChange={changed} />);
  const user = userEvent.setup();
  await screen.findByRole("option", { name: "Self Only" });
  expect(changed).toHaveBeenLastCalledWith(undefined);
  await user.selectOptions(screen.getByRole("combobox"), "SELF_ONLY");
  expect(changed).toHaveBeenLastCalledWith(undefined);
  await user.click(screen.getByLabelText(/I reviewed this video/));
  await waitFor(() =>
    expect(changed).toHaveBeenLastCalledWith(
      expect.objectContaining({
        privacy_level: "SELF_ONLY",
        content_preview_confirmed: true,
        express_consent_given: true,
        allow_duet: false,
      }),
    ),
  );
  expect(screen.getByLabelText("Allow duet")).toBeDisabled();
});

it("keeps the second connection's credentials separate and clears its key", async () => {
  vi.mocked(invoke).mockImplementation(async command => command === "hybrid_settings" ? {
    enabled: true, profileId: "012345678901234567890123", clientId: "", hasZernioKey: true,
    secondaryEnabled: false, secondaryProfileId: "", hasSecondaryZernioKey: false, youtubeConnected: true,
  } : undefined);
  render(<HybridSettingsPanel />);
  const user = userEvent.setup();
  await waitFor(() => expect(screen.getByLabelText("Zernio Profile ID")).toHaveValue("012345678901234567890123"));
  const key = screen.getByLabelText("Zernio B API key");
  await user.type(key, "secondary-test-key");
  await user.type(screen.getByLabelText("Zernio B Profile ID"), "abcdef012345678901234567");
  await user.click(screen.getByLabelText("Enable connection B"));
  await user.click(screen.getByRole("button", { name: "Save settings" }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("hybrid_save", expect.objectContaining({
    secondaryEnabled: true, secondaryApiKey: "secondary-test-key", secondaryProfileId: "abcdef012345678901234567", apiKey: undefined,
  })));
  expect(key).toHaveValue("");
});
