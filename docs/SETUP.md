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

## HTTPS deployment

Use a dedicated host and DNS name. See [deployment](DEPLOYMENT.md) for Docker and private-gateway options.

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

Choose `RelayMac` or `RelayIOS`. Set `RELAY_APPLE_TEAM`, `RELAY_BUNDLE_ID_PREFIX`, and optionally `RELAY_DEFAULT_SERVER` in `~/.config/relay/local.env`, then run `pnpm apple:generate`. The generator preserves normal environment-variable overrides. Without private settings, it uses `org.example.relay` and a loopback server for unsigned build checks. Use a unique reverse-DNS prefix for your own signed apps.

The app and share extension derive matching app-group and shared Keychain entitlements from these values. Keep the same prefix and team for updates to an existing installation, otherwise credentials and queued uploads may become inaccessible. Generated Xcode projects, entitlements, and extension plists stay untracked because they can contain private values.

The native app first uses an already-saved server address, then its configured build default. Browser approval does not automatically connect a native app. Select **Connect personal device** and approve its displayed code from Connections on a trusted client. Physical devices need an HTTPS URL.

Development signing requires your own Apple account, certificate, and device registration. Renew signing assets before their expiry. Source availability does not include App Store, TestFlight, Developer ID signing, or notarization.

To build updated signed versions:

```sh
xcodebuild -project apps/apple/Relay.xcodeproj -scheme RelayMac -configuration Release -derivedDataPath apps/apple/build -allowProvisioningUpdates -allowProvisioningDeviceRegistration build
xcodebuild -project apps/apple/Relay.xcodeproj -scheme RelayIOS -configuration Release -destination 'id=YOUR_IPHONE_UDID' -derivedDataPath apps/apple/build-ios -allowProvisioningUpdates -allowProvisioningDeviceRegistration build
```

Quit Relay before replacing the Mac app bundle. Replace the whole bundle rather than copying over an existing one: leftover Debug files invalidate a Release signature. Check the installed bundle with `codesign --verify --deep --strict /Applications/Relay.app`. App data and Keychain credentials live outside that bundle.

The connected iPhone can be installed with `xcrun devicectl device install app --device YOUR_IPHONE_UDID apps/apple/build-ios/Build/Products/Release-iphoneos/Relay.app`. Installation preserves its app data and Keychain credentials. Open the installed app on the phone; complete any iOS Developer Mode or trust requirements if prompted.

On a physical iPhone, use your HTTPS service URL, not `127.0.0.1`. Loopback on a simulator can reach the Mac's local service for testing. The Mac launches in the menu bar without a Dock icon or an inbox window. Click its menu bar icon to send and receive, or choose **Open inbox window** for a separate resizable window. Closing that window keeps Relay running in the background. The Mac also supports drag in/out, file picker, clipboard send, save, preview, and sharing. Its global clipboard shortcut is Control-Option-Command-R while Relay is running. **Connections → Mac → Open Relay at login** is optional and initially off. Use **Quit Relay** in the menu panel's footer to stop it.

The Mac menu panel fits its content instead of using a fixed tall window. It shows up to six file rows before scrolling, a layout choice to keep it within the screen. Its text field starts on one line and grows to four visible lines before scrolling; this does not limit the amount of text that can be sent. The separate inbox window remains resizable. Incoming Mac banners are 320 × 76 points and offer Copy File, Download, and Open directly. Text items offer Copy Text. Download saves to Downloads using the same numbered-copy behavior as inbox downloads. Banners dismiss after eight idle seconds; this existing timeout pauses during an action and restarts when its result appears.

Mac file and image rows have direct **Copy File** and **Save to Downloads** icon buttons; hover to see their labels. Copy the file, then paste into Finder or another app that accepts files. Save to Downloads writes immediately without a dialog and uses a numbered filename when the name already exists. The app has sandbox permission for the Downloads folder. Preview, Save a Copy for another location, and Delete remain in the menu; right-click also offers the quick actions.

For copying, Relay decrypts the file into its existing private temporary preview cache and places its local file URL on the clipboard. That source remains temporary and can be cleaned up when the inbox item expires or is deleted; paste it into a destination to keep a separate copy. Text items retain **Copy text**.

On iPhone, the native tab bar has **Send**, **Inbox**, and **Connections**. Send opens by default, keeps its draft when switching tabs, and contains the text editor, file picker, clipboard, and destination selector. Inbox contains received items and their preview, copy, export, and share actions. Connections contains device approvals and recovery settings. The Mac keeps its combined send/inbox view and top selector.

Connection status appears in the mobile navigation header beside Refresh. The mobile UI does not display the internal file-size limit. While editing a message, Done appears in that same native navigation bar. Tap Done, tap outside the editor, or swipe the content to dismiss the keyboard without losing the draft.

Share text, links, images, or files through **Share → Relay**. If Relay is hidden, enable it in the share sheet's More list. The extension queues encrypted content before attempting upload. If interrupted or offline, open Relay to finish. The main app supports receiving, copy, Files export, previews, and onward sharing.

The Mac share extension uses the same shared Keychain and outbox container as the Mac app. A correctly signed app and extension are required for shared-container access. Simulator builds used for Keychain verification must also be signed; `CODE_SIGNING_ALLOWED=NO` verifies compilation only. Incoming iPhone items refresh when the native app opens; APNs notifications and background receipt remain unimplemented.

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
