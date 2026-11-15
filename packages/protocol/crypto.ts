const encoder = new TextEncoder();
export const utf8 = (value: string) => encoder.encode(value);
export function base64(bytes: Uint8Array): string {
  let result = "";
  for (let i = 0; i < bytes.length; i += 8192)
    result += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(result);
}
export function unbase64(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}
export function randomKey(): string {
  return base64(crypto.getRandomValues(new Uint8Array(32)));
}
function buffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}
async function aes(key: string) {
  return crypto.subtle.importKey(
    "raw",
    buffer(unbase64(key)),
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
}
// Wire format matches CryptoKit AES.GCM.SealedBox.combined: nonce | ciphertext | tag.
export async function seal(
  key: string,
  plaintext: Uint8Array,
  aad: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: utf8(aad) },
    await aes(key),
    buffer(plaintext),
  );
  const result = new Uint8Array(12 + encrypted.byteLength);
  result.set(nonce);
  result.set(new Uint8Array(encrypted), 12);
  return result;
}
export async function open(
  key: string,
  payload: Uint8Array,
  aad: string,
): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(
    await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: buffer(payload.subarray(0, 12)),
        additionalData: utf8(aad),
      },
      await aes(key),
      buffer(payload.subarray(12)),
    ),
  );
}
export async function createPairKey() {
  const keys = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  const publicKey = base64(
    new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey)),
  );
  return {
    privateKey: keys.privateKey,
    publicKey,
    code: await fingerprint(publicKey),
  };
}
export async function fingerprint(publicKey: string) {
  const hash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", buffer(unbase64(publicKey))),
  );
  return Array.from(hash.subarray(0, 6), (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}
export async function pairingKey(
  privateKey: CryptoKey,
  publicKey: string,
  id: string,
): Promise<string> {
  const pub = await crypto.subtle.importKey(
    "raw",
    buffer(unbase64(publicKey)),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "ECDH", public: pub },
    privateKey,
    256,
  );
  const material = await crypto.subtle.importKey("raw", bits, "HKDF", false, [
    "deriveBits",
  ]);
  return base64(
    new Uint8Array(
      await crypto.subtle.deriveBits(
        {
          name: "HKDF",
          hash: "SHA-256",
          salt: utf8(id),
          info: utf8("relay-pair-v1"),
        },
        material,
        256,
      ),
    ),
  );
}
export const transferAAD = (id: string, scope: string) =>
  `relay-v1:${id}:${scope}`;
