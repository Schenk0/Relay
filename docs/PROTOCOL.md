# Relay protocol v1

The service stores ciphertext and operational metadata. It never receives the inbox key or decrypted content. The client code uses Web Crypto and Apple CryptoKit, not a custom cipher. This is a new implementation, not an independently audited security product.

## Credentials and approval

The service has one personal inbox. First setup requires a random secret available on the server. Setup runs once. Each approved device gets a distinct 256-bit bearer credential; only its SHA-256 digest is retained in the device record. TLS is required outside loopback. All personal devices have permission to approve and revoke other devices.

Pairing uses an ephemeral P-256 ECDH key on the requesting client. Its raw public key is the 65-byte uncompressed X9.63 point. The displayed 12-character code is the first six bytes of SHA-256(public key), encoded as uppercase hex. A trusted client looks up this code and recomputes the fingerprint before approval. The user must compare the actual code on the other device, its name, and whether it requests personal or temporary access.

The approver creates another ephemeral P-256 key. Both sides derive 256 ECDH bits and then use HKDF-SHA256 with UTF-8 pairing ID as salt and `relay-pair-v1` as info, producing a 32-byte AES key. The approved inbox or session key is AES-GCM encrypted with AAD `relay-pair-v1:<pair-id>`. The requesting client unwraps it locally.

Pairing requests last five minutes, are rate limited, and cannot be approved twice. Polling requires an independent 256-bit request secret. The server retains the issued credential inside the pending result until the client acknowledges successful durable storage or the request expires. This permits recovery from a lost poll response. The public code is not a bearer credential.

The entire web delivery origin remains trusted to deliver unmodified JavaScript. End-to-end encryption does not protect against a compromised client, browser extension, operating system, or malicious replacement of the web app. It protects stored transfer contents from ordinary server storage inspection.

## Session boundaries

Personal clients share a random 32-byte inbox key. Temporary browser sessions receive their own random 32-byte session key. The service authorizes session clients only for rows with their session ID, and never gives them personal device records or the personal inbox key.

An approver also encrypts the session key under the inbox key with AAD `relay-session-v1:<pair-id>`. The stored `encryptedKey` is `<pair-id>.<base64-envelope>`. This lets personal clients read the session's incoming and outgoing transfers after that session expires. Session credentials last four hours. Revocation immediately blocks subsequent requests; it cannot retract an already downloaded file, preview, or key. Removing a personal client does not rotate keys already known by it.

## Transfer envelope

Each transfer has a random UUID, an author device ID, a scope of `owner` or a temporary session ID, timestamps, ciphertext byte count, encrypted metadata, and a ciphertext body. UUIDs are canonical lowercase strings.

All AES operations use AES-256-GCM with a fresh cryptographically random 12-byte nonce and a 16-byte tag. Serialized envelopes are `nonce || ciphertext || tag`, matching CryptoKit `combined`. Encrypted metadata is standard base64. HTTP upload/download bodies are raw binary envelopes.

Metadata plaintext is UTF-8 JSON `{name,type,kind}`, with `kind` equal to `text` or `file`. Its AAD is `relay-v1:<uuid>:<scope>:metadata`. The content AAD is `relay-v1:<uuid>:<scope>:content`. Original file bytes are encrypted without conversion. Invalid metadata remains deletable as an unreadable item.

`PUT /api/transfers/:uuid?scope=...` requires the encrypted metadata in `X-Relay-Metadata` and a bearer credential. Successful upload begins a 24-hour lifetime. A repeated upload from the same author to the same scope is idempotent and does not reset expiry. It never overwrites the original content. Expired uploads cannot be downloaded or listed; physical cleanup runs every minute.

## Local storage and recovery

Native credentials and keys live in Keychain, shared only with the signed companion share extension. Encrypted outbox files use the app group container. The web client keeps credentials and keys in that browser origin's local storage and encrypted pending uploads in IndexedDB. A temporary browser session also uses browser storage so reloads can resume; disconnect removes its active credentials from local storage. Use a private browser window when the machine should retain no browser data after closing it.

A recovery JSON file contains a device bearer credential and the inbox key. It is deliberately portable, unencrypted, and highly sensitive. It can restore that device's access while its credential remains valid. Revoking that device also invalidates its recovery file. There is no server-side key recovery or account-password reset.

Decrypted previews are transient. Native preview directories are removed when their item disappears during a successful refresh. Browser object URLs are revoked when previews close. Exported downloads, clipboard content, and OS-managed preview caches cannot be remotely erased.

## Limits

These are conservative first-version product limits, not discovered platform maxima.

- Share extensions accept up to ten files, images, or URLs per share-sheet selection; larger selections need separate batches. This matching limit is a conservative product choice.
- 25 MiB plaintext per file; clients reject larger files before upload. The service allows only the 28-byte encryption overhead beyond that limit.
- 512 MiB total stored ciphertext in the personal service; excess uploads fail until content is deleted or cleaned up.
- 24-hour transfer lifetime from successful upload; retrieval fails at expiry, including for devices that stayed offline.
- Four-hour temporary sessions; fresh approval is needed afterward.
- Five-minute pairing requests; expired requests must be restarted.
- Thirty uploads and five new pairing requests per IP per minute; excess requests receive HTTP 429 and can be retried later.

Clients currently encrypt files in memory and poll every five seconds while running. Browsers pause polling when hidden. Large/resumable streaming uploads, automatic permanent key rotation, and APNs delivery are not implemented.
