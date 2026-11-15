# Run Relay

## Local web app

Requires Node 24 or newer and pnpm 10. No hosted account or paid service is required to run locally.

```sh
pnpm install
pnpm dev
```

Open `http://localhost:5173`. The Vite development app proxies API requests to the service at `http://127.0.0.1:4318`.

The service creates `data/setup-secret` with private file permissions. Enter that value in the first browser's setup form. Never commit it. The first device creates the inbox key locally. Save a recovery file from Connections and keep it private.

Use one hostname consistently. Browser credentials are stored per origin, so `localhost` and `127.0.0.1` are different browser clients and must be paired separately.

For a single-process production build:

```sh
pnpm build
pnpm start
```

Open `http://127.0.0.1:4318`. Outside loopback, serve HTTPS. The native apps reject insecure remote service URLs; browser encryption also requires a secure context.

## Internet service

Use a dedicated host and DNS name. This repository does not provision, publish, or modify an existing server.

1. Point your hostname's DNS at the host. Allow inbound TCP 80 and 443.
2. Copy `.env.example` to `.env`, set `RELAY_DOMAIN`, and set a random `RELAY_SETUP_SECRET` of at least 24 characters. Generate one with `openssl rand -base64 32`.
3. Run `docker compose up -d --build`. Caddy obtains HTTPS certificates and proxies the web app and API. Relay's service port is not published directly.
4. Open the HTTPS hostname, create the first inbox with your setup secret, and save a recovery file.
5. Enter the same hostname in native apps and approve them from Connections. Open it on remote machines to start temporary sessions.

The Docker setup uses persistent volumes for SQLite and Caddy. Keep the SQLite volume private. Storage, bandwidth, the host, and your domain have provider-specific costs; nothing is automatically subscribed or billed by this repository. Back up the volume if you need to preserve device authorizations. Its ciphertext alone cannot recover lost inbox keys.

The service is single-user and single-instance. Do not run multiple replicas against its SQLite file. Configure request/body/time limits on any additional proxy to permit 25 MiB uploads and 120-second requests. Keep the Node runtime and dependencies updated.

## Apple apps

Requires Xcode 16 or newer and XcodeGen. These apps use native SwiftUI; no JavaScript runtime runs inside them.

```sh
brew install xcodegen
pnpm apple:generate
open apps/apple/Relay.xcodeproj
```

Choose `RelayMac` or `RelayIOS`. Set your development team on the app and matching share extension targets. Use matching app-group and shared Keychain entitlements. The default identifiers are `org.example.relay.mac`, `org.example.relay.ios`, and their `.share` extensions; the shared app group is `group.org.example.relay`. If these identifiers are unavailable in your Apple team, change them consistently in `project.yml` and the generated entitlements, then regenerate.

On a physical iPhone, use your HTTPS service URL, not `127.0.0.1`. Loopback on a simulator can reach the Mac's local service for testing. Approve the displayed code on an existing personal device. The Mac provides a menu bar inbox, drag in/out, file picker, clipboard send, save, preview, and sharing. Its global clipboard shortcut is Control-Option-Command-R while Relay is running.

On iPhone, share text, links, images, or files through **Share → Relay**. If Relay is hidden, enable it in the share sheet's More list. The extension queues encrypted content before attempting upload. If interrupted or offline, open Relay to finish. The main app supports receiving, copy, Files export, previews, and onward sharing.

The Mac share extension uses the same shared Keychain and outbox container as the Mac app. A correctly signed app and extension are required for shared-container access. Builds made with signing disabled verify compilation only. Distribution to your physical iPhone requires your Apple signing setup; no TestFlight or App Store submission has been performed.

## Checks

```sh
pnpm check
pnpm exec playwright install chromium
pnpm test:browser
xcodebuild -project apps/apple/Relay.xcodeproj -scheme RelayMac -configuration Debug CODE_SIGNING_ALLOWED=NO build
xcodebuild -project apps/apple/Relay.xcodeproj -scheme RelayIOS -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

`pnpm test` includes Swift/Web Crypto interoperability and requires Swift on macOS. `pnpm test:service` runs the service-only tests on other hosts. Browser tests build on `pnpm build`, use an isolated temporary database, and do not touch your local service data.

Apple's [app group configuration guide](https://developer.apple.com/documentation/xcode/configuring-app-groups) describes the registered `group.` identifiers used here and the alternative team-prefixed macOS format.
