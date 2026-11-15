import { z } from "zod";
import { get, set, del, keys } from "idb-keyval";
import {
  accessSchema,
  identitySchema,
  deviceSchema,
  transferSchema,
  pairSchema,
  pairTicketSchema,
  pairPollSchema,
  FILE_LIMIT,
  type Identity,
  type Metadata,
  type Transfer,
} from "../../../packages/protocol";
import {
  base64,
  unbase64,
  createPairKey,
  pairingKey,
  randomKey,
  seal,
  open,
  utf8,
  transferAAD,
  fingerprint,
} from "../../../packages/protocol/crypto";
export function storedIdentity() {
  try {
    return identitySchema.parse(
      JSON.parse(localStorage.getItem("relay-identity") ?? "null") as unknown,
    );
  } catch {
    return null;
  }
}
export function saveIdentity(identity: Identity) {
  localStorage.setItem("relay-identity", JSON.stringify(identity));
}
export async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  options: RequestInit = {},
  identity?: Identity,
) {
  const headers = new Headers(options.headers);
  if (identity) headers.set("Authorization", `Bearer ${identity.token}`);
  const response = await fetch(`/api${path}`, { ...options, headers });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as unknown;
    const message = z.object({ error: z.string() }).safeParse(body);
    throw new Error(
      message.success
        ? message.data.error
        : `Request failed (${response.status}).`,
    );
  }
  return schema.parse((await response.json()) as unknown);
}
const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
export const getHealth = () =>
  request("/health", z.object({ ok: z.boolean(), initialized: z.boolean() }));
export async function setup(secret: string, name: string) {
  const key = randomKey();
  const access = await request("/setup", accessSchema, json({ secret, name }));
  const identity = { ...access, key, server: location.origin };
  saveIdentity(identity);
  return identity;
}
export async function startPair(name: string, scope: "owner" | "session") {
  const pair = await createPairKey();
  const ticket = await request(
    "/pairs",
    pairTicketSchema,
    json({ name, scope, publicKey: pair.publicKey, code: pair.code }),
  );
  const pending = { ...pair, ...ticket, scope };
  await set("relay-pair", pending);
  return pending;
}
export type PendingPair = Awaited<ReturnType<typeof startPair>>;
export const loadPair = () => get<PendingPair>("relay-pair");
export async function pollPair(pair: PendingPair) {
  const response = await request(`/pairs/${pair.id}`, pairPollSchema, {
    headers: { Authorization: `Bearer ${pair.secret}` },
  });
  if (!response.result) return null;
  const result = response.result;
  const key = base64(
    await open(
      await pairingKey(pair.privateKey, result.publicKey, pair.id),
      unbase64(result.wrappedKey),
      `relay-pair-v1:${pair.id}`,
    ),
  );
  const identity = { ...result.access, key, server: location.origin };
  saveIdentity(identity);
  await del("relay-pair");
  await request(`/pairs/${pair.id}`, z.object({ ok: z.boolean() }), {
    method: "DELETE",
    headers: { Authorization: `Bearer ${pair.secret}` },
  }).catch(() => {});
  return identity;
}
export const cancelPair = () => del("relay-pair");
export const findPair = (code: string, identity: Identity) =>
  request(`/pairs/code/${encodeURIComponent(code)}`, pairSchema, {}, identity);
export async function approvePair(
  pair: z.infer<typeof pairSchema>,
  identity: Identity,
) {
  if ((await fingerprint(pair.publicKey)) !== pair.code)
    throw new Error("Pairing fingerprint does not match.");
  const ephemeral = await createPairKey(),
    key = pair.scope === "owner" ? identity.key : randomKey();
  const wrappedKey = base64(
    await seal(
      await pairingKey(ephemeral.privateKey, pair.publicKey, pair.id),
      unbase64(key),
      `relay-pair-v1:${pair.id}`,
    ),
  );
  const encryptedKey =
    pair.scope === "session"
      ? base64(
          await seal(
            identity.key,
            unbase64(key),
            `relay-session-v1:${pair.id}`,
          ),
        )
      : null;
  // The session-key envelope uses the pairing ID, stored alongside it, for authenticated binding.
  await request(
    `/pairs/${pair.id}/approve`,
    z.object({ ok: z.boolean() }),
    json({
      publicKey: ephemeral.publicKey,
      wrappedKey,
      encryptedKey: encryptedKey ? `${pair.id}.${encryptedKey}` : null,
    }),
    identity,
  );
}
export const getDevices = (identity: Identity) =>
  request("/devices", z.array(deviceSchema), {}, identity);
export const getTransfers = (identity: Identity) =>
  request("/transfers", z.array(transferSchema), {}, identity);
export const revoke = (id: string, identity: Identity) =>
  request(
    `/devices/${id}`,
    z.object({ ok: z.boolean() }),
    { method: "DELETE" },
    identity,
  );
export const removeTransfer = (id: string, identity: Identity) =>
  request(
    `/transfers/${id}`,
    z.object({ ok: z.boolean() }),
    { method: "DELETE" },
    identity,
  );
export async function scopeKey(
  scope: string,
  identity: Identity,
  devices: Awaited<ReturnType<typeof getDevices>>,
) {
  if (identity.scope === "session" || scope === "owner") return identity.key;
  const envelope = devices.find((d) => d.id === scope)?.encryptedKey;
  if (!envelope) throw new Error("This connection key is unavailable.");
  const dot = envelope.indexOf("."),
    pairId = envelope.slice(0, dot),
    cipher = envelope.slice(dot + 1);
  return base64(
    await open(identity.key, unbase64(cipher), `relay-session-v1:${pairId}`),
  );
}
export const metadataFor = async (item: Transfer, key: string) =>
  metadataSchema.parse(
    JSON.parse(
      new TextDecoder().decode(
        await open(
          key,
          unbase64(item.metadata),
          `${transferAAD(item.id, item.scope)}:metadata`,
        ),
      ),
    ) as unknown,
  );
import { metadataSchema } from "../../../packages/protocol";
export async function download(
  item: Transfer,
  key: string,
  identity: Identity,
) {
  const response = await fetch(`/api/transfers/${item.id}`, {
    headers: { Authorization: `Bearer ${identity.token}` },
  });
  if (!response.ok)
    throw new Error("Could not download this item. Refresh and try again.");
  return open(
    key,
    new Uint8Array(await response.arrayBuffer()),
    `${transferAAD(item.id, item.scope)}:content`,
  );
}
export type Queued = {
  id: string;
  scope: string;
  owner: string;
  metadata: string;
  body: Uint8Array<ArrayBuffer>;
  error?: string;
};
const queuePrefix = (identity: Identity) => `relay-upload:${identity.id}:`;
const queueKey = (identity: Identity, id: string) =>
  `${queuePrefix(identity)}${id}`;
export async function queueFor(
  identity: Identity,
): Promise<Array<{ id: string }>> {
  return (await keys())
    .filter(
      (key): key is string =>
        typeof key === "string" && key.startsWith(queuePrefix(identity)),
    )
    .map((key) => ({ id: key.slice(queuePrefix(identity).length) }));
}
export async function enqueue(
  metadata: Metadata,
  data: Uint8Array,
  scope: string,
  key: string,
  identity: Identity,
) {
  if (data.length > FILE_LIMIT)
    throw new Error("Files must be 25 MiB or smaller.");
  const id = crypto.randomUUID(),
    aad = transferAAD(id, scope);
  const entry: Queued = {
    id,
    scope,
    owner: identity.id,
    metadata: base64(
      await seal(key, utf8(JSON.stringify(metadata)), `${aad}:metadata`),
    ),
    body: await seal(key, data, `${aad}:content`),
  };
  await set(queueKey(identity, id), entry);
  return entry;
}
export async function discardQueued(id: string, identity: Identity) {
  await del(queueKey(identity, id));
}
export async function sendQueued(
  reference: { id: string },
  identity: Identity,
) {
  const entry = await get<Queued>(queueKey(identity, reference.id));
  if (!entry) return;
  if (entry.owner !== identity.id)
    throw new Error("This queued item belongs to a different connection.");
  const response = await fetch(
    `/api/transfers/${entry.id}?scope=${encodeURIComponent(entry.scope)}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${identity.token}`,
        "Content-Type": "application/octet-stream",
        "X-Relay-Metadata": entry.metadata,
      },
      body: entry.body.buffer,
    },
  );
  if (!response.ok) {
    const error = z
      .object({ error: z.string() })
      .safeParse((await response.json()) as unknown);
    throw new Error(error.success ? error.data.error : "Upload failed.");
  }
  await discardQueued(entry.id, identity);
}
export function saveBytes(bytes: Uint8Array, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name.replace(/[\/\\\x00-\x1f]/g, "_");
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
