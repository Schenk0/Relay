# Contributing

Keep changes focused and explain the user-visible behavior and relevant verification. Discuss changes to encryption, authentication, storage formats, or expiry before implementing them.

Use Node 24+ and the pnpm version declared in `package.json`. On macOS with Swift installed:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm exec playwright install chromium
pnpm test:browser
```

On Linux, run `pnpm privacy:check`, `pnpm test:config`, `pnpm typecheck`, `pnpm test:service`, and `pnpm build`. The interoperability test requires Apple's CryptoKit and runs on macOS.

For Apple changes, install Xcode and XcodeGen, run `pnpm apple:generate`, and build the affected schemes. Use your own private signing configuration. Generated projects and signing files stay ignored. Check an unsigned build before relying on physical-device signing.

Never include personal infrastructure details, credentials, recovery files, user uploads, or database files in patches, screenshots, logs, or fixtures. Use reserved example domains and synthetic test content. Run `pnpm privacy:check` before committing; run a full-history secret scan before publishing a release.
