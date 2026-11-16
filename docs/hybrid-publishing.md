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

Delivery records are keyed by project and account. Successful destinations are skipped on retry, including when another destination failed. Reposting the same project/account as a new post is intentionally not supported. Scheduled deliveries already accepted by Zernio/YouTube do not need Tayang to stay open. Generating a video and handing it to the services still requires the desktop to run (tray mode is sufficient).

YouTube uploads use 8 MiB resumable chunks. Repeat Post after a connection failure to probe and resume the existing session. The file hash must match the original render. If a session has expired or credentials are missing, inspect YouTube Studio rather than starting a duplicate. The app keeps ambiguous uploads for inspection. Refresh status probes completion and checks processing status.

Zernio receives an Idempotency-Key per project/account. After an ambiguous response, retry resends the original saved request within 23 hours, inside Zernio's documented 24-hour idempotency window. The original caption/media/schedule are retained for that recovery. Outside that window, inspect Zernio before taking further action. A known failed provider post also requires inspection in the provider dashboard; it is not recreated automatically.

## Running

Use `pnpm install --frozen-lockfile` then `pnpm dev:desktop`. The development app has its own application identifier/data folder. Do not install an upstream release over a customized build: the upstream updater does not contain these changes.

## Validation limits

Tests cover per-account delivery persistence, scheduled YouTube privacy, credential-input clearing, and TikTok consent gating. Real provider uploads require your credentials and must be checked separately; mocked or local tests do not prove account eligibility, publishing permissions, quota or public visibility. External Google OAuth projects left in Testing may issue refresh tokens lasting seven days. Publishing requirements must be checked in the provider consoles for your project.

References: https://docs.zernio.com/guides/media-uploads ; https://docs.zernio.com/posts/create-post ; https://docs.zernio.com/platforms/tiktok/posts ; https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol ; https://developers.google.com/identity/protocols/oauth2/native-app

## Checks on this Windows checkout

- Workspace TypeScript checks and frontend production build passed.
- 77 focused frontend tests across the social, autopilot, Hybrid and translation-guard suites passed.
- `cargo check -j 1` passed for the native application.
- The two native Hybrid tests compiled, but their executable could not start with the installed Windows GNU toolchain (`STATUS_ENTRYPOINT_NOT_FOUND`; an alternate runtime path also produced `STATUS_INVALID_IMAGE_FORMAT`). Their assertions have **not** been observed passing. Run `cargo test -j 1 hybrid::tests --lib` in a working native toolchain before treating native runtime behavior as verified.
- Visual review used a temporary mock preview of the new controls, not a live provider connection. No API key, Google client or video was sent to Zernio/YouTube during validation.
