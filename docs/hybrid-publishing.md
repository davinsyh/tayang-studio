# Personal Hybrid publishing

This fork adds local publishing without a Tayang account. Enable it on **Social media → Publish with your own service accounts**. Existing cloud publishing is used while Hybrid is disabled. Project generation and rendering continue to use the existing agent workflow.

## Setup

1. In Zernio, create a profile and connect one TikTok account and one Instagram Business/Creator account. Enter the profile ID and an API key in the app. Zernio currently includes two connections free; limits and pricing belong to Zernio, not this fork.
2. Create a Google Cloud project, enable YouTube Data API v3, configure the OAuth consent screen and create a **Desktop app** OAuth client. Enter its client ID and client secret, save, then select **Connect YouTube**. Finish consent in your browser. Your Google account must have a YouTube channel. The app requests youtube.upload and youtube.readonly, uses PKCE and a random state, and receives the callback on a temporary loopback port.
3. Save **Use Hybrid publishing**, refresh accounts and render a video. Open its Post dialog, choose destinations and privacy, then post or schedule. Immediate YouTube uploads default to private. Scheduling uploads privately now and sets publishAt to publish publicly at the selected time. Use a private test upload first.

No credentials are bundled or committed. Keys, refresh tokens and YouTube resumable-session URLs live in the OS keychain under app.tayang.studio / hybrid:*; they never return to the webview. This integration fails if the keychain cannot store credentials. Non-secret config and delivery records live in publishing.db beside the app database. Editing Google client ID clears the old refresh token; reconnect afterward.

## Autopilot and review

Instagram and YouTube use the existing autopilot posting flow. YouTube autopilot posts immediately as private unless a future publication time is set; future scheduled posts become public. Review generated videos before choosing an unattended workflow, including whether the content is made for kids (the current autopilot upload default is false).

TikTok requires per-video preview confirmation, consent and privacy selection. This fork does not fabricate that consent: automated TikTok attempts record a failure asking you to use the video's Post dialog. Other selected destinations still run. Review/Approve in Calendar does not substitute for the TikTok consent controls. Use Post on the video to finish it.

## Retry and status

The Post dialog preselects all connected accounts. TikTok and Instagram receive the caption and hashtags; the separate title is used for YouTube. Titles and captions are filled from the project's `post.json` when available, with Write with AI available to prepare a draft. TikTok still requires a creator-supported privacy choice and per-video consent before Post now is enabled. Saving a different Zernio Profile ID refreshes the connected account list automatically; use the profile that actually contains the connected accounts.

While posting, the dialog shows each selected account's upload stage, byte count and percentage. Zernio transfers stream in 256 KiB blocks and wait for the storage acknowledgement before marking the transfer complete. YouTube progress follows the server's confirmed offsets for its 8 MiB resumable chunks. The UI reserves 100% until transfer completion and labels subsequent platform processing separately; it does not invent a processing percentage. Accounts run sequentially, so waiting accounts stay labelled as waiting. Upload progress is scoped to the current IPC request and does not send credentials or signed session URLs to the frontend. Keep the app open during transfer. Provider status polling continues while an unfinished result is open.

`cargo test --test upload-stream` exercises the production file stream without linking the desktop UI runtime into the test process. It verifies byte preservation, bounded chunks and progress below completion before server acknowledgement. This separate target avoids the full library test executable's existing Windows runtime dependency issue.

The dialog probes the latest render and reports whether its dimensions and duration meet YouTube's Shorts format rules (square or vertical, at most 180 seconds). Eligible renders get an Open Shorts player link for YouTube results. This selects a player URL; classification and public visibility remain YouTube decisions, and depend separately on processing and upload privacy.

Delivery records are keyed by project and account. Successful destinations are skipped on retry, including when another destination failed. Reposting the same project/account as a new post is intentionally not supported. Scheduled deliveries already accepted by Zernio/YouTube do not need Tayang to stay open. Generating a video and handing it to the services still requires the desktop to run (tray mode is sufficient).

YouTube uploads use 8 MiB resumable chunks. Repeat Post after a connection failure to probe and resume the existing session. The file hash must match the original render. If a session has expired or credentials are missing, inspect YouTube Studio rather than starting a duplicate. The app keeps ambiguous uploads for inspection. Refresh status probes completion and checks processing status.

Zernio receives an Idempotency-Key per project/account. After an ambiguous response, retry resends the original saved request within 23 hours, inside Zernio's documented 24-hour idempotency window. The original caption/media/schedule are retained for that recovery. Outside that window, inspect Zernio before taking further action. A known failed provider post also requires inspection in the provider dashboard; it is not recreated automatically.

## Running

Use `pnpm install --frozen-lockfile` then `pnpm dev:desktop`. On this personal fork, both development and release builds use `app.tayang.studio`, so they open the installed application's existing data. Close the installed application before launching the fork. The development window remains titled Tayang Studio Dev. Automatic and manual upstream updates are disabled; review and merge upstream source changes, then rebuild this fork.

On Windows this checkout is at `C:\Project Video\tayang-studio`. You can also double-click `jalankan-tayang.cmd`. The development launcher uses the target folder's Windows short path to work around GNU windres include paths containing spaces; build files still live inside this checkout.

The Desktop and Start Menu shortcuts named **Tayang Studio Pribadi** use `scripts/open-desktop.vbs` and `scripts/open-desktop.ps1`. They start the development service without a console window and bring an existing personal-build window forward. Launch logs are stored under `%LOCALAPPDATA%\Tayang-Studio-Pribadi\logs`. The shortcut leaves the official application's shortcut unchanged. Closing the app stops the development session; opening the shortcut starts it again.

The active data folder is `%APPDATA%\app.tayang.studio`. Chat/style/project data stays in the original `tayang.db`; the separate `publishing.db` was moved from the old Dev folder. Hybrid credentials use the same Windows Credential Manager service across both application identifiers, so they do not need to be copied as plaintext. Back up the data folder before switching builds or importing upstream database migrations. Single-instance activation prevents normal side-by-side launches of the two builds with this identifier; do not bypass it.

## Validation limits

Tests cover per-account delivery persistence, scheduled YouTube privacy, credential-input clearing, and TikTok consent gating. Real provider uploads require your credentials and must be checked separately; mocked or local tests do not prove account eligibility, publishing permissions, quota or public visibility. External Google OAuth projects left in Testing may issue refresh tokens lasting seven days. Publishing requirements must be checked in the provider consoles for your project.

References: https://docs.zernio.com/guides/media-uploads ; https://docs.zernio.com/posts/create-post ; https://docs.zernio.com/platforms/tiktok/posts ; https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol ; https://developers.google.com/identity/protocols/oauth2/native-app

## Checks on this Windows checkout

- Workspace TypeScript checks and frontend production build passed.
- 77 focused frontend tests across the social, autopilot, Hybrid and translation-guard suites passed.
- `cargo check -j 1` passed for the native application.
- The two native Hybrid tests compiled, but their executable could not start with the installed Windows GNU toolchain (`STATUS_ENTRYPOINT_NOT_FOUND`; an alternate runtime path also produced `STATUS_INVALID_IMAGE_FORMAT`). Their assertions have **not** been observed passing. Run `cargo test -j 1 hybrid::tests --lib` in a working native toolchain before treating native runtime behavior as verified.
- Visual review used a temporary mock preview of the new controls, not a live provider connection. No API key, Google client or video was sent to Zernio/YouTube during validation.

## Windows GNU desktop build

The library target uses `rlib` only, which the desktop executable links directly. Building an additional `cdylib` with the Windows GNU linker exported more symbols than its ordinal limit (`export ordinal too large`). `cargo build --bin tayang-studio -j 1` now succeeds, and `pnpm dev:desktop` was observed opening the Tayang Studio Dev window on this Windows machine. Mobile embedding would need its own static/shared library build configuration.

## Optional second Zernio connection

Connection A keeps the existing TikTok/Instagram API key and profile. In the same settings panel, enter connection B's API key and Profile ID, enable B and save. Connect YouTube and Facebook from Social accounts or the second Zernio dashboard. Facebook must be a Page with the required permissions. Credentials remain separate in the OS keychain (`hybrid:zernio_secondary` for B). Existing A IDs and delivery records remain unchanged; B destinations use a `z2:` prefix so status polling and retries use the correct key.

Once a connected YouTube account exists on B, direct Google is hidden from destinations to prevent selecting both. Its credentials remain saved as a fallback. An existing YouTube delivery on another connection blocks a duplicate upload for that project; inspect the original result instead. Captions go to TikTok, Instagram and Facebook; YouTube receives a separate title and the caption as description. B sends Facebook videos with `contentType: reel`. Platform media requirements still apply.

Each connection reports account-list failures without hiding working destinations from the other connection. Missing or inactive B does not erase direct YouTube credentials. Keys are never returned to the settings page, only presence flags.

Using multiple accounts does not establish entitlement to additional free quota. Review Zernio's current terms and pricing; this fork does not bypass provider limits or guarantee free service. Avoid posting a live video merely to test configuration. `cargo test --test zernio-routes` checks account/key routing boundaries and platform payloads without the desktop test runtime.
