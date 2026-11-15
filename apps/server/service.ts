import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import serveStatic from "@fastify/static";
import { DatabaseSync } from "node:sqlite";
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  FILE_LIMIT,
  STORAGE_LIMIT,
  TTL,
  PAIR_TTL,
  SESSION_TTL,
  deviceSchema,
  transferSchema,
  accessSchema,
  pairStartSchema,
  pairSchema,
  pairApprovalSchema,
  setupSchema,
} from "../../packages/protocol/index";
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const token = () => randomBytes(32).toString("base64url");
const storedDevice = deviceSchema.extend({ tokenHash: z.string() });
const storedPair = pairSchema.extend({
  secretHash: z.string(),
  result: z.unknown().optional(),
});
const documentRow = z.object({ data: z.string() });
function read<T>(row: unknown, schema: z.ZodType<T>): T | undefined {
  if (!row) return;
  return schema.parse(JSON.parse(documentRow.parse(row).data) as unknown);
}
function fail(message: string, statusCode = 400): never {
  throw Object.assign(new Error(message), { statusCode });
}
export async function createService(options: {
  dataDir: string;
  setupSecret: string;
  now?: () => number;
  webRoot?: string;
}) {
  const now = options.now ?? Date.now;
  mkdirSync(options.dataDir, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path.join(options.dataDir, "relay.sqlite"));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA secure_delete=ON;
    CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY,data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS pairs(id TEXT PRIMARY KEY,data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS settings(id TEXT PRIMARY KEY,data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS transfers(id TEXT PRIMARY KEY,scope TEXT NOT NULL,author TEXT NOT NULL,createdAt INTEGER NOT NULL,expiresAt INTEGER NOT NULL,size INTEGER NOT NULL,metadata TEXT NOT NULL,payload BLOB NOT NULL);
    CREATE INDEX IF NOT EXISTS transfer_expiry ON transfers(expiresAt);`);
  const app = Fastify({
    logger: false,
    bodyLimit: FILE_LIMIT + 28,
    requestTimeout: 120_000,
  });
  await app.register(rateLimit, {
    max: 240,
    timeWindow: "1 minute",
    cache: 10000,
  });
  app.addContentTypeParser(
    "application/octet-stream",
    { parseAs: "buffer" },
    (_request, body, done) => done(null, body),
  );
  app.addHook("onSend", async (_request, reply, payload) => {
    reply
      .header("Cache-Control", "no-store")
      .header("X-Content-Type-Options", "nosniff")
      .header("Referrer-Policy", "no-referrer");
    reply.header(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    return payload;
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) {
      void reply.code(400).send({ error: "Invalid request." });
      return;
    }
    const known = z
      .object({ statusCode: z.number().optional(), message: z.string() })
      .safeParse(error);
    const status = known.success ? (known.data.statusCode ?? 500) : 500;
    void reply.code(status).send({
      error:
        status >= 500 && status !== 507
          ? "Service error. Try again."
          : known.success
            ? known.data.message
            : "Invalid request.",
    });
  });
  const getDevice = (id: string) =>
    read(
      db.prepare("SELECT data FROM devices WHERE id=?").get(id),
      storedDevice,
    );
  const allDevices = () =>
    db
      .prepare("SELECT data FROM devices")
      .all()
      .map((row) => read(row, storedDevice)!);
  const putDevice = (device: z.infer<typeof storedDevice>) =>
    db
      .prepare("INSERT OR REPLACE INTO devices VALUES (?,?)")
      .run(device.id, JSON.stringify(device));
  const getPair = (id: string) =>
    read(db.prepare("SELECT data FROM pairs WHERE id=?").get(id), storedPair);
  const putPair = (pair: z.infer<typeof storedPair>) =>
    db
      .prepare("INSERT OR REPLACE INTO pairs VALUES (?,?)")
      .run(pair.id, JSON.stringify(pair));
  const authenticate = (authorization: string | undefined, owner = false) => {
    const bearer = authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
    if (!bearer) fail("Connect this device first.", 401);
    const device = allDevices().find((d) => d.tokenHash === hash(bearer));
    if (
      !device ||
      device.revoked ||
      (device.expiresAt !== null && device.expiresAt <= now())
    )
      fail("This connection has expired or was revoked.", 401);
    if (owner && device.scope !== "owner")
      fail("A trusted personal device is required.", 403);
    return device;
  };
  const validPair = (id: string, authorization: string | undefined) => {
    const pair = getPair(id);
    if (!pair || pair.expiresAt <= now())
      fail("Pairing expired. Start again.", 404);
    if (hash(authorization?.replace(/^Bearer /, "") ?? "") !== pair.secretHash)
      fail("Invalid pairing credential.", 401);
    return pair;
  };
  const createDevice = (
    name: string,
    scope: "owner" | "session",
    encryptedKey: string | null,
  ) => {
    const credential = token();
    const device = {
      id: randomUUID(),
      name,
      scope,
      tokenHash: hash(credential),
      createdAt: now(),
      expiresAt: scope === "owner" ? null : now() + SESSION_TTL,
      revoked: false,
      encryptedKey,
    };
    putDevice(device);
    return {
      device,
      access: accessSchema.parse({ ...device, token: credential }),
    };
  };
  function cleanup() {
    db.prepare("DELETE FROM transfers WHERE expiresAt<=?").run(now());
    for (const row of db.prepare("SELECT data FROM pairs").all()) {
      const p = read(row, storedPair)!;
      if (p.expiresAt <= now())
        db.prepare("DELETE FROM pairs WHERE id=?").run(p.id);
    }
  }
  cleanup();
  const timer = setInterval(cleanup, 60_000);
  timer.unref();
  app.addHook("onClose", async () => {
    clearInterval(timer);
    db.close();
  });
  app.get("/api/health", async () => ({
    ok: true,
    initialized: !!db
      .prepare("SELECT id FROM settings WHERE id='initialized'")
      .get(),
    fileLimit: FILE_LIMIT,
    ttl: TTL,
  }));
  app.post(
    "/api/setup",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const body = setupSchema.parse(request.body);
      if (db.prepare("SELECT id FROM settings WHERE id='initialized'").get())
        fail("Relay is already set up.", 409);
      const a = Buffer.from(hash(body.secret)),
        b = Buffer.from(hash(options.setupSecret));
      if (!timingSafeEqual(a, b)) fail("Incorrect setup secret.", 403);
      const { access } = createDevice(body.name, "owner", null);
      db.prepare("INSERT INTO settings VALUES ('initialized','true')").run();
      return reply.code(201).send(access);
    },
  );
  app.get("/api/me", async (request) =>
    deviceSchema.parse(authenticate(request.headers.authorization)),
  );
  app.get("/api/devices", async (request) => {
    authenticate(request.headers.authorization, true);
    return allDevices().map((d) => deviceSchema.parse(d));
  });
  app.delete<{ Params: { id: string } }>(
    "/api/devices/:id",
    async (request) => {
      const actor = authenticate(request.headers.authorization);
      if (actor.scope !== "owner" && actor.id !== request.params.id)
        fail("Not permitted.", 403);
      const device = getDevice(request.params.id);
      if (!device) fail("Connection not found.", 404);
      putDevice({ ...device, revoked: true });
      return { ok: true };
    },
  );
  app.post(
    "/api/pairs",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      if (!db.prepare("SELECT id FROM settings WHERE id='initialized'").get())
        fail("Set up your personal inbox first.", 409);
      const body = pairStartSchema.parse(request.body);
      const raw = Buffer.from(body.publicKey, "base64");
      if (
        raw.length !== 65 ||
        raw[0] !== 4 ||
        createHash("sha256")
          .update(raw)
          .digest("hex")
          .slice(0, 12)
          .toUpperCase() !== body.code
      )
        fail("Invalid pairing key.");
      const secret = token(),
        pair = {
          ...body,
          id: randomUUID(),
          secretHash: hash(secret),
          expiresAt: now() + PAIR_TTL,
        };
      putPair(pair);
      return reply
        .code(201)
        .send({ id: pair.id, secret, expiresAt: pair.expiresAt });
    },
  );
  app.get<{ Params: { code: string } }>(
    "/api/pairs/code/:code",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request) => {
      authenticate(request.headers.authorization, true);
      const code = request.params.code
        .replace(/[^a-fA-F0-9]/g, "")
        .toUpperCase();
      const pair = db
        .prepare("SELECT data FROM pairs")
        .all()
        .map((r) => read(r, storedPair)!)
        .find((p) => p.code === code && p.expiresAt > now() && !p.result);
      if (!pair) fail("No pending request with that code.", 404);
      return pairSchema.parse(pair);
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/pairs/:id/approve",
    async (request) => {
      authenticate(request.headers.authorization, true);
      const body = pairApprovalSchema.parse(request.body),
        pair = getPair(request.params.id);
      if (!pair || pair.expiresAt <= now()) fail("Pairing expired.", 404);
      if (pair.result) fail("Already approved.", 409);
      if ((pair.scope === "session") !== (body.encryptedKey !== null))
        fail("Invalid session key.");
      const { access } = createDevice(pair.name, pair.scope, body.encryptedKey);
      putPair({
        ...pair,
        result: {
          access,
          publicKey: body.publicKey,
          wrappedKey: body.wrappedKey,
        },
      });
      return { ok: true };
    },
  );
  app.get<{ Params: { id: string } }>("/api/pairs/:id", async (request) => {
    const pair = validPair(request.params.id, request.headers.authorization);
    return pair.result
      ? { status: "approved", result: pair.result }
      : { status: "pending" };
  });
  app.delete<{ Params: { id: string } }>("/api/pairs/:id", async (request) => {
    const pair = validPair(request.params.id, request.headers.authorization);
    db.prepare("DELETE FROM pairs WHERE id=?").run(pair.id);
    return { ok: true };
  });
  app.get("/api/transfers", async (request) => {
    const actor = authenticate(request.headers.authorization);
    const rows =
      actor.scope === "owner"
        ? db
            .prepare(
              "SELECT id,scope,author,createdAt,expiresAt,size,metadata FROM transfers WHERE expiresAt>? ORDER BY createdAt DESC",
            )
            .all(now())
        : db
            .prepare(
              "SELECT id,scope,author,createdAt,expiresAt,size,metadata FROM transfers WHERE expiresAt>? AND scope=? ORDER BY createdAt DESC",
            )
            .all(now(), actor.id);
    return rows.map((r) => transferSchema.parse(r));
  });
  app.put<{ Params: { id: string }; Querystring: { scope?: string } }>(
    "/api/transfers/:id",
    {
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
      onRequest: async (request) => {
        authenticate(request.headers.authorization);
      },
    },
    async (request, reply) => {
      const actor = authenticate(request.headers.authorization),
        id = z.uuid().parse(request.params.id),
        scope =
          actor.scope === "session"
            ? actor.id
            : (request.query.scope ?? "owner");
      if (
        actor.scope === "session" &&
        request.query.scope &&
        request.query.scope !== actor.id
      )
        fail("Not permitted.", 403);
      if (scope !== "owner") {
        const destination = getDevice(scope);
        if (
          !destination ||
          destination.scope !== "session" ||
          destination.revoked ||
          destination.expiresAt! <= now()
        )
          fail("Destination session is no longer available.", 403);
      }
      const metadata = z
        .string()
        .min(40)
        .max(8192)
        .regex(/^[A-Za-z0-9+/=]+$/)
        .parse(request.headers["x-relay-metadata"]);
      const payload = request.body;
      if (
        !Buffer.isBuffer(payload) ||
        payload.length < 28 ||
        payload.length > FILE_LIMIT + 28
      )
        fail("Invalid transfer size.", 413);
      const existing = db
        .prepare(
          "SELECT id,scope,author,createdAt,expiresAt,size,metadata FROM transfers WHERE id=?",
        )
        .get(id);
      if (existing) {
        const item = transferSchema.parse(existing);
        if (item.author !== actor.id || item.scope !== scope)
          fail("Transfer identifier already used.", 409);
        return item;
      }
      const usage = z
        .object({ size: z.number() })
        .parse(
          db
            .prepare("SELECT COALESCE(SUM(size),0) AS size FROM transfers")
            .get(),
        ).size;
      if (usage + payload.length > STORAGE_LIMIT)
        fail(
          "Inbox storage is full. Delete some items or wait for expiry.",
          507,
        );
      const createdAt = now();
      db.prepare("INSERT INTO transfers VALUES (?,?,?,?,?,?,?,?)").run(
        id,
        scope,
        actor.id,
        createdAt,
        createdAt + TTL,
        payload.length,
        metadata,
        payload,
      );
      return reply.code(201).send({
        id,
        scope,
        author: actor.id,
        createdAt,
        expiresAt: createdAt + TTL,
        size: payload.length,
        metadata,
      });
    },
  );
  const getTransfer = (id: string, actor: z.infer<typeof storedDevice>) => {
    const row = db
      .prepare(
        "SELECT id,scope,author,createdAt,expiresAt,size,metadata FROM transfers WHERE id=? AND expiresAt>?",
      )
      .get(id, now());
    if (!row) fail("This item has expired or was deleted.", 404);
    const item = transferSchema.parse(row);
    if (actor.scope !== "owner" && item.scope !== actor.id)
      fail("Not permitted.", 403);
    return item;
  };
  app.get<{ Params: { id: string } }>(
    "/api/transfers/:id",
    async (request, reply) => {
      const actor = authenticate(request.headers.authorization);
      getTransfer(request.params.id, actor);
      const row = z
        .object({ payload: z.instanceof(Uint8Array) })
        .parse(
          db
            .prepare("SELECT payload FROM transfers WHERE id=?")
            .get(request.params.id),
        );
      return reply
        .type("application/octet-stream")
        .send(Buffer.from(row.payload));
    },
  );
  app.delete<{ Params: { id: string } }>(
    "/api/transfers/:id",
    async (request) => {
      const actor = authenticate(request.headers.authorization);
      getTransfer(request.params.id, actor);
      db.prepare("DELETE FROM transfers WHERE id=?").run(request.params.id);
      return { ok: true };
    },
  );
  if (options.webRoot && existsSync(options.webRoot)) {
    await app.register(serveStatic, { root: options.webRoot });
    app.setNotFoundHandler((request, reply) =>
      request.url.startsWith("/api/")
        ? reply.code(404).send({ error: "Not found." })
        : reply.sendFile("index.html"),
    );
  }
  return app;
}
