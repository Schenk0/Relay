# Relay

Move text, links, images, and files between iPhone, Mac, and any browser. Every client sends and receives. Items expire automatically instead of accumulating in your Downloads folder.

## Run

Requires Node 24+, pnpm 10, and Swift on macOS for the cross-platform crypto tests.

```sh
pnpm install
pnpm dev
```

Open `http://localhost:5173`. Enter the private setup secret from `data/setup-secret` to create your first inbox. Save a recovery file in Connections. Approve other personal devices or restricted browser sessions there.

For the built web app and API on one port:

```sh
pnpm build
pnpm start
```

Open `http://127.0.0.1:4318`. Use HTTPS for real devices and remote machines. Relay is deployed privately on service-host at `https://service.example.ts.net` through Tailscale Serve; see [service-host access and operations](docs/service-host.md). A separate public-host deployment with Caddy is also included.

## What's built

- **Web:** text/link send, multi-file selection, drag and drop, image paste, inbox filtering, previews, download, copy, deletion, encrypted offline queue, device approval, revocation, and recovery export/import.
- **Remote browsers:** temporary sessions can upload to your personal inbox and receive items you explicitly send to that session. They cannot see the rest of your inbox. No installation or email login is needed.
- **Mac:** native menu bar inbox, an incoming-item panel, clipboard shortcut, file picker, drop files into the inbox, drag received files out, previews, export, device approval, and system share extension.
- **iPhone:** native inbox, Share → Relay extension, text/files/clipboard send, previews, copy, export to Files, onward sharing, approval, and recovery import/export.
- **Service:** one private inbox, distinct hashed device credentials, encrypted content and filenames, cross-network delivery, idempotent upload, expiry, revocation, disk persistence, quotas, and rate limits.

The web and Swift clients share an authenticated AES-GCM wire format and P-256/HKDF pairing protocol. Cross-language tests prove both can decrypt each other's content and derive the same pairing keys. See [protocol and security details](docs/PROTOCOL.md).

## Apple builds

```sh
brew install xcodegen
pnpm apple:generate
open apps/apple/Relay.xcodeproj
```

Choose `RelayMac` or `RelayIOS`. Configure your Apple team and matching app-group and shared Keychain signing for the app and share extension. Enter your service URL and approve the displayed code from a trusted device. The Mac clipboard shortcut is Control-Option-Command-R while Relay is running.

See [complete setup and deployment instructions](docs/SETUP.md).

## Limits and practical boundaries

- Files are limited to **25 MiB**. Larger files are rejected before encryption in the clients. This conservative memory limit is a product choice, not a platform maximum.
- The service stores up to **512 MiB** of ciphertext. When full, new uploads fail until content is deleted or cleaned up.
- Items expire **24 hours after upload**. They disappear from Relay and cannot be downloaded after expiry; server cleanup runs each minute. Exported files and clipboard copies remain yours.
- Temporary browser credentials expire after **4 hours**. Pairing approval requests expire after **5 minutes**.
- The web app and running native apps poll every **5 seconds**. Native share extensions queue before sending. iPhone background receipt and push notifications are not implemented; reopen Relay to reconcile pending items.
- This is a single-user, single-service application. It has no billing service, hosted account dependency, public links, permanent cloud library, or automatic clipboard collection.

Keys and credentials are kept in Keychain on native clients and browser storage on web clients. A recovery file contains both and must stay private. There is no server-side key recovery. Revocation blocks new downloads but cannot erase copies already received. A compromised remote machine can inspect files you use there. The implementation has not had an independent security audit.

## Verify

```sh
pnpm check
pnpm exec playwright install chromium
pnpm test:browser
```

Service tests cover encrypted transfers, authentication, pairing, session isolation, revocation, duplicate retries, tampering, and expiry. Browser tests use separate personal and remote contexts, verify a binary download byte for byte, send back in the opposite direction, queue offline, and check revocation. Swift tests verify Web Crypto/CryptoKit interoperability.

[Verification notes](docs/VERIFICATION.md) record actual native and browser checks, including what still needs a signed physical-device test. [Original outline](docs/OUTLINE.md) is retained as the planning record.

## Layout

```text
apps/server/       Fastify API and SQLite storage
apps/web/          React + TypeScript + Vite browser client
apps/apple/        SwiftUI iPhone/Mac apps and native share extensions
packages/protocol/ API schemas and browser cryptography
scripts/           Isolated browser-test server
```

The service uses SQLite instead of the outline's proposed Convex backend. It runs without external account setup and can be deployed on your own HTTPS host. Hosting and signing are separate from the source build.
