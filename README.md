# Relay

A temporary inbox for moving text, links, images, and files between your iPhone, Mac, and any browser, in both directions.

Status: project outline only. No application, accounts, cloud resources, or deployments have been created. Relay is a working name.

## The experience

- On iPhone, use **Share → Relay** without opening the main app. Open Relay to receive, preview, copy, save, or share items onward.
- On Mac, drop files onto a menu bar target, use the system share menu, or send selected clipboard content with a shortcut. Incoming items appear in a small shelf without stealing keyboard focus.
- In a browser, drop files, choose files, paste an image, or enter text. Download, preview, or copy incoming items. This works on a remote machine without installing anything.
- Your personal clients show the same temporary inbox. A remote browser can instead join a restricted transfer session that exposes only items explicitly sent to that session.

All clients send and receive. Images and arbitrary files retain their original bytes and filenames. Previews are an additional convenience, not a requirement for transferring a file.

## The remote-machine workflow

1. Open the web app inside the remote machine's browser.
2. Request a temporary session. Approve its QR code or matching code from an already trusted device, checking the browser identity and requested access.
3. Upload the remote machine's files to your inbox. They become available on your Mac, iPhone, and personal web client.
4. To send something back, choose that browser session as the destination from a trusted client.
5. End or revoke the session. It can no longer send or fetch files. It never receives access to your existing inbox.

The browser only accesses files you choose or drop into it. Revocation cannot remove files already downloaded onto a remote machine. A remote machine that is itself compromised can observe anything you open there.

## Delivery and lifetime

Use a shared internet service for the first version. Devices can be on different networks and do not have to be online simultaneously. This replaces the earlier nearby-only proposal so remote machines use the same delivery system as the native apps.

1. The sender prepares an item and uploads its encrypted content.
2. The service stores temporary content and announces availability to authorized clients.
3. The recipient downloads and decrypts it when reachable.
4. The item expires or the user deletes it; access ends and cleanup removes service and app-cache copies.

Proposed default: items expire **24 hours after a successful upload**. This is a product starting point, not an external requirement or measured optimum. At expiry, clients hide the item and the service denies new downloads; physical storage cleanup may follow asynchronously. Items can expire before an offline device receives them. Exported files and clipboard copies are outside Relay's cleanup control.

For the first version, **Save** exports to Files, Photos, or a chosen folder. Permanent cloud storage and indefinite pinning are outside the initial scope. The sender's original files are never deleted.

Show honest states: uploading, available, downloading, downloaded, failed, expired. A successful upload does not mean another device has downloaded it. Retry interrupted operations without creating duplicate inbox entries. Pause offline sends locally and make that state visible.

iOS background refresh is best effort. Notifications can alert the user; opening the app reconciles the inbox. Do not rely on a silent push to complete delivery or promise immediate receipt while the phone app is closed. Browser receiving happens while the page is open; later visits retrieve unexpired items.

## Privacy and access

- Require authentication for the owner and explicit approval for each additional device or temporary browser session.
- Plan end-to-end encryption of content and sensitive metadata, including filenames, across Swift and web clients. The service will still see operational metadata such as sizes, timing, and device identifiers.
- Prove encryption interoperability, device approval, revocation, and recovery before using real private files. Use established cryptographic libraries and a documented envelope format.
- Temporary sessions get only the keys and permissions for their own transfers. QR and code pairing must use expiring, single-use approval challenges and rate limits.
- Do not collect clipboard history or read the clipboard automatically. Sending clipboard content is an explicit action.
- Keep plaintext, filenames, pairing credentials, and content keys out of logs. Require encrypted transport and authorization for content access.

## Proposed implementation

These are recommendations for implementation, not installed dependencies or completed security guarantees.

| Part | Starting choice | Purpose |
| --- | --- | --- |
| Web | React, TypeScript, Vite, Tailwind, pnpm | Browser inbox and temporary remote sessions |
| iPhone | SwiftUI with a native Share Extension | System sharing and receiving inbox |
| Mac | SwiftUI with AppKit where needed | Menu bar, shelf, drag and drop, share integration, shortcut |
| Shared service | Convex functions, database, and file storage | Authorization, transfer metadata, temporary encrypted blobs, expiry |
| Notifications | APNs for native Apple clients | New-item alerts; inbox remains the source of truth |

Use one protocol across clients, with shared fixtures for its Swift and TypeScript implementations. Start with the service path; evaluate direct local transfers later only if latency, cost, or offline use warrants them.

Authentication provider, key recovery, hosting region, file-size limits, session duration, storage quotas, and operating cost remain implementation questions. Validate them in the first milestone; do not assume a free tier or promise unlimited transfers. Prefer direct storage transfers to proxying large file bodies through functions.

Planned layout:

```text
apps/web/          Browser app
apps/apple/        iPhone, Mac, share extensions, shared Swift code
convex/           Service and expiry jobs
packages/protocol/ Transfer definitions and interoperability fixtures
docs/             Product and technical notes
```

Create source folders when implementation starts rather than adding empty scaffolding now.

## Build order and proof

1. **Browser to browser.** Prove the full send/receive loop across different networks, encrypted content compatibility with a small Swift test client, owner authentication, restricted session approval, expiry, and revocation. Validate file sizes, quotas, recovery, and cost. This should already replace emailing files from a remote machine.
2. **Mac companion.** Add the menu bar sender, incoming shelf, copy, preview, drag out, save, and shortcut. Prove transfer in both directions with the web app.
3. **iPhone companion.** Add the receiving inbox, Share Extension, onward sharing, and notifications. Prove transfers in both directions with Mac and web, including phone suspension and reopening.

Completion means every pair of clients can transfer text, links, images, multiple files, and a non-previewable file in both directions. Focus verification on byte-for-byte integrity, access isolation, offline retry, duplicate prevention, expiry, revocation, and Swift/web encryption compatibility. Verify the real iOS Share Extension on a device before calling the sharing flow complete.

Outside the first version: public sharing links, collaboration, Android/Windows native apps, a CLI, automatic clipboard sync, folder sync, direct peer-to-peer transport, and permanent cloud storage. Windows and Linux machines use the web app.

## References

- [Apple Share Extensions](https://developer.apple.com/library/archive/documentation/General/Conceptual/ExtensibilityPG/Share.html)
- [Apple background notification delivery limits](https://developer.apple.com/documentation/usernotifications/pushing-background-updates-to-your-app)
- [Convex file storage](https://docs.convex.dev/file-storage/overview)
- [Convex uploads](https://docs.convex.dev/file-storage/upload-files)
- [Convex authenticated file serving](https://docs.convex.dev/file-storage/serve-files)

## Visual overview

[Compact project diagram](docs/overview.html). This describes the proposed product, not an implemented interface.
