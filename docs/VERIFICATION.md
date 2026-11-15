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

Physical-iPhone installation and the signed Mac distribution flow need your Apple team and provisioning. The Mac app and extension have been compiled; the full signed Mac UI, global shortcut, incoming panel, and drag-out workflow have not been driven end to end. Compilation is not evidence that those OS integrations have been exercised.

The live deployment now uses private Tailscale HTTPS. Public internet exposure has not been configured; access from machines outside the tailnet remains outside this deployment. The implementation uses ordinary authenticated HTTPS requests rather than a local discovery protocol.

The Mac had no active Docker daemon for the initial build checks. The image was subsequently built and run successfully in Docker on service-host.

APNs and iPhone background delivery are not implemented. Phone receipt is reconciled when the app opens. The cryptographic format is interoperable, but the product has not undergone independent security review or adversarial penetration testing.

The automation session and Device panel were closed after testing, the previously stopped shared simulator was shut down again, and the isolated verification service was stopped. Existing simulator data and the test installation were preserved. One generated PNG was added to Photos for the share test; existing photos were left intact.


## service-host deployment

The dedicated Docker service was deployed with a read-only root filesystem, unprivileged app user, capability restrictions, persistent database volume, and resource limits. Private Tailscale HTTPS was enabled without changing T3 or SSH routes. Live client checks verified encryption, binary integrity, transfers in both directions, restart persistence, restricted-session isolation, and revocation. Verification transfers were removed, and the personal inbox remains initialized for use with its privately saved recovery file.
