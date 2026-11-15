# Verification

Initial build checks ran locally on 15 November 2026 without production data. The later authorized service-host deployment is recorded below.

## Automated

- TypeScript strict checks and Vite production build pass.
- Service tests pass for authenticated encrypted transfers, session approval and isolation, transfers in both directions, credential revocation, duplicate retries, expiration, tampering, file-size boundaries, and restart persistence.
- The service accepts a 25 MiB plaintext envelope and rejects one byte above the allowed ciphertext size.
- Swift CryptoKit and Web Crypto decrypt each other's output and derive identical P-256/HKDF pairing keys.
- Playwright uses separate personal and remote browser contexts. It approves the remote session, proves the personal item stays hidden there, downloads a binary file byte for byte, receives text back, previews an image, retries an offline queue, verifies mobile layout, and checks revocation.
- `pnpm audit --prod` reports no known vulnerabilities at the time checked. This is a dependency check, not an application security audit.
- Xcode builds succeed for the Mac app, iPhone simulator app, and both embedded share extensions.

## Native workflow checks

An existing shared iPhone simulator on the local Mac was reused. The simulator was initially shut down. Its machine-specific selection is recorded in the ignored `.verification/device.json`; no simulator was created or erased.

Verified on the iOS 27.0 simulator:

- Personal-device pairing through the app UI, with approval from a separately authenticated owner client.
- Shared-Keychain credential persistence between the iPhone app and its share extension.
- Web client to iPhone text decryption and inbox display.
- iPhone to web text transfer, with matching decrypted content.
- Safari → Share → Relay, successful upload of the page URL, and matching decryption on the receiving client.
- Photos → Share → Relay using the final extension, with the received PNG verified byte for byte against the source test image.
- The share extension renders in dark mode and loads multi-file content one provider at a time.

## Remaining external verification

Signed Release builds and both share extensions now pass Xcode and signature validation. The Mac app is installed at `/Applications/Relay.app` and the iPhone app was installed wirelessly on the maintainer's already-paired physical iPhone. Physical-phone launch, pairing, and sharing still require the maintainer's participation; the automation Device panel lists simulators only and rejected the physical device ID.

The installed Mac UI successfully paired to the public inbox, decrypted its metadata, uploaded text, and sent clipboard text. A native Files-button check reproduced a conflicting-file-importer bug; after combining recovery and upload into one importer, the chooser opened and uploaded the selected verification file. Authenticated downloads decrypted the native uploads correctly and confirmed one copy of each. The Mac kept its credential through app restarts. The reused iPhone simulator paired to the public service and displayed decrypted native-Mac items. Verification uploads were removed afterward; existing user uploads were preserved.

The global clipboard shortcut's Carbon registration and event-handler installation both returned success. Synthetic input through the computer-use tool did not trigger that global handler, so a physical-keyboard check is still required. Incoming-panel timing, native Mac drag-out, Mac share-sheet integration, and the launch-at-login setting have not been fully driven end to end. The initial simulator share-sheet checks above remain the evidence for the iOS extension; the current simulator runner falls back to XCTest with limited access to remote extension UI.

The live deployment now has public HTTPS at `http://127.0.0.1:4318`, backed by the same service-host service as the private Tailscale endpoint. The implementation uses ordinary authenticated HTTPS requests rather than a local discovery protocol. The public-domain checks below ran from the maintainer's Mac; a separate machine outside the home network has not been driven end to end.

The Mac had no active Docker daemon for the initial build checks. The image was subsequently built and run successfully in Docker on service-host.

APNs and iPhone background delivery are not implemented. Phone receipt is reconciled when the app opens. The cryptographic format is interoperable, but the product has not undergone independent security review or adversarial penetration testing.

The automation session and Device panel were closed after testing, the previously stopped shared simulator was shut down again, and the isolated verification service was stopped. Existing simulator data and the test installation were preserved. One generated PNG was added to Photos for the share test; existing photos were left intact.


## service-host deployment

The dedicated Docker service was deployed with a read-only root filesystem, unprivileged app user, capability restrictions, persistent database volume, and resource limits. Private Tailscale HTTPS was enabled without changing T3 or SSH routes. Live client checks verified encryption, binary integrity, transfers in both directions, restart persistence, restricted-session isolation, and revocation. Verification transfers were removed, and the personal inbox remains initialized for use with its privately saved recovery file.

## Public domain

On 15 November 2026, the `relay` A record was added in Porkbun through the maintainer's signed-in Opera session. The dashboard showed the new record and all existing records were preserved. Porkbun's authoritative DNS and public resolvers at `1.1.1.1` and `8.8.8.8` returned the configured address.

The existing gateway Caddy gateway was extended with Relay's virtual host and gracefully reloaded after configuration validation. Its existing Home Assistant and API routes returned HTTP 200 before and after; their containers were not restarted. The service-host image was rebuilt with explicit trusted-proxy handling; strict TypeScript checks and all four service tests passed, including a focused test proving that untrusted callers cannot evade request limits by rotating forwarded addresses.

Normal TLS certificate verification passed for `relay.example.com`. An authenticated 1 MiB binary upload and download through that hostname decrypted byte for byte. Unauthenticated listing and download returned HTTP 401, and the verification item was removed. These requests pinned the current public IP while the Mac's resolver retained an earlier negative DNS cache entry; certificate validation remained enabled. No browser security warning was bypassed.
