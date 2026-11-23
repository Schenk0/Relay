# Verification

Initial build checks ran locally on 15 November 2026 without production data. The later authorized the service host deployment is recorded below.

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

The mobile layout was subsequently split into native Send, Inbox, and Connections tabs. On the reused Shared iPhone 17 Pro simulator, all three tabs opened, Inbox had no composer, and an unsent draft survived switching through Inbox and Connections back to Send. The Send editor's Done button dismissed the software keyboard and made the tab bar accessible again. iOS simulator, signed iPhone Release, and Mac Release builds passed. The updated signed iPhone app was installed wirelessly with its existing data preserved. The Mac retains its original combined inbox/composer layout.

The Mac layout was then compacted: the menu panel uses content-based height, a bounded scrolling list, an opaque background, and no duplicate navigation header. Its text field expands from one to four visible lines. Mac and iPhone Release builds passed, the installed Mac bundle passed deep signature verification, and the restarted Mac app retained its inbox connection. Computer-use checks confirmed multiline entry and clearing the field without sending verification content. The iPhone UI was not changed or reinstalled for this Mac-only change.

Mobile keyboard follow-up: connection status and the size limit moved from the footer into the navigation header on all tabs. The keyboard accessory was removed; Done now uses the native navigation toolbar. On Shared iPhone 17 Pro, the software keyboard was shown and the header stayed clear of it. Tapping blank content dismissed the keyboard and preserved the draft; tapping inside the editor reopened it normally. The iPhone Release and Mac Release builds passed, and the signed mobile update was installed wirelessly.

Mac file clipboard: added **Copy file** for file/image items and a standard right-click actions menu. A dedicated 4 KiB binary verification upload was copied through the installed app's native item menu and pasted with Command-V into an isolated Finder folder. The resulting file retained its original filename and matched every source byte. The verification upload was removed and existing user uploads were preserved. Signed Mac and iPhone Release builds passed; the installed Mac bundle passed deep signature verification. The iPhone app was not changed or reinstalled.

Mac quick-action follow-up: file rows now expose copy and download icon buttons directly, with labeled hover help; the shared action handlers remain available by right-click. Downloads saves without a file picker using the app's Downloads sandbox entitlement. Saving a dedicated binary fixture twice produced the original filename and a numbered copy, both with matching bytes; the original file's modification time was unchanged. Copying and pasting the same fixture into Finder also preserved every byte. The test upload and both test Downloads files were removed. The installed Mac signature and Mac/iPhone Release builds passed; the iPhone app was not reinstalled.

Mac background mode: Relay now declares `LSUIElement` and places its menu-bar scene first, keeping the separate inbox available on request. The signed Mac Release build passed, the installed bundle passed deep signature verification, and its generated Info.plist contains Boolean `LSUIElement = true`. After restarting the installed app, Launch Services reported the running process as `type="UIElement"`, confirming agent mode rather than a Dock application. Computer use timed out attaching to the windowless agent, so opening the menu panel and separate inbox in this mode was not verified through UI automation. The iPhone app was not changed or reinstalled.

Mac notification actions: reduced the banner from 360 × 90 to 320 × 76 points and added direct Copy File/Copy Text and Download controls with success/error feedback. The installed signed Release app showed the compact banner for a disposable binary upload. Computer use clicked Download and Copy File in the banner and observed both success messages without opening the inbox. The Downloads file and the file URL published to the clipboard both matched all 4 KiB of source bytes. The test upload and Downloads file were removed. Mac and iPhone Release builds passed; the installed Mac signature passed deep verification and its process remained in UIElement mode. The iPhone app was not reinstalled. Text copy and error feedback were compiled but not separately driven through the banner.

An existing private deployment has been verified over public HTTPS using authenticated requests. Deployment-specific addresses and operator notes are maintained outside this repository.

The Mac had no active Docker daemon for the initial build checks. The image was subsequently built and run successfully in Docker on the service host.

APNs and iPhone background delivery are not implemented. Phone receipt is reconciled when the app opens. The cryptographic format is interoperable, but the product has not undergone independent security review or adversarial penetration testing.

The automation session and Device panel were closed after testing, the previously stopped shared simulator was shut down again, and the isolated verification service was stopped. Existing simulator data and the test installation were preserved. One generated PNG was added to Photos for the share test; existing photos were left intact.


