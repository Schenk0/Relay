import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { createService } from "../apps/server/service";
import {
  accessSchema,
  pairTicketSchema,
  pairPollSchema,
  transferSchema,
  TTL,
  type Access,
} from "../packages/protocol";
import {
  base64,
  unbase64,
  randomKey,
  createPairKey,
  pairingKey,
  seal,
  open,
  utf8,
  transferAAD,
} from "../packages/protocol/crypto";
import { z } from "zod";
test("encrypted roundtrip, pairing, session isolation, revocation, retry, and expiry", async () => {
  const dir = mkdtempSync(`${tmpdir()}/relay-test-`);
  let now = Date.now();
  const app = await createService({
    dataDir: dir,
    setupSecret: "a-test-setup-secret-at-least-24-chars",
    now: () => now,
  });
  try {
    const setup = await app.inject({
      method: "POST",
      url: "/api/setup",
      payload: {
        secret: "a-test-setup-secret-at-least-24-chars",
        name: "Owner",
      },
    });
    assert.equal(setup.statusCode, 201);
    const owner = accessSchema.parse(setup.json());
    const vaultKey = randomKey();
    const auth = (a: Access) => ({ authorization: `Bearer ${a.token}` });
    const put = async (
      a: Access,
      scope: string,
      data: Uint8Array,
      id = randomUUID(),
    ) => {
      const key = scope === "owner" ? vaultKey : sessionKey,
        aad = transferAAD(id, scope);
      const meta = base64(
        await seal(
          key,
          utf8(
            JSON.stringify({
              name: "private.bin",
              type: "application/octet-stream",
              kind: "file",
            }),
          ),
          `${aad}:metadata`,
        ),
      );
      const body = await seal(key, data, `${aad}:content`);
      const response = await app.inject({
        method: "PUT",
        url: `/api/transfers/${id}?scope=${scope}`,
        headers: {
          ...auth(a),
          "content-type": "application/octet-stream",
          "x-relay-metadata": meta,
        },
        payload: Buffer.from(body),
      });
      return { response, body, id };
    };
    const personal = await put(owner, "owner", utf8("personal secret"));
    assert.equal(personal.response.statusCode, 201);
    assert.equal((await app.inject({ url: "/api/transfers" })).statusCode, 401);
    const pairKeys = await createPairKey();
    const ticket = pairTicketSchema.parse(
      (
        await app.inject({
          method: "POST",
          url: "/api/pairs",
          payload: {
            name: "Remote",
            scope: "session",
            publicKey: pairKeys.publicKey,
            code: pairKeys.code,
          },
        })
      ).json(),
    );
    const sessionKey = randomKey(),
      approver = await createPairKey(),
      wrapping = await pairingKey(
        approver.privateKey,
        pairKeys.publicKey,
        ticket.id,
      );
    const wrappedKey = base64(
      await seal(wrapping, unbase64(sessionKey), `relay-pair-v1:${ticket.id}`),
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: `/api/pairs/${ticket.id}/approve`,
          headers: auth(owner),
          payload: {
            publicKey: approver.publicKey,
            wrappedKey,
            encryptedKey: `${ticket.id}.${base64(await seal(vaultKey, unbase64(sessionKey), `relay-session-v1:${ticket.id}`))}`,
          },
        })
      ).statusCode,
      200,
    );
    const poll = pairPollSchema.parse(
      (
        await app.inject({
          url: `/api/pairs/${ticket.id}`,
          headers: { authorization: `Bearer ${ticket.secret}` },
        })
      ).json(),
    );
    assert.ok(poll.result);
    const remote = poll.result.access;
    assert.equal(
      base64(
        await open(
          await pairingKey(
            pairKeys.privateKey,
            poll.result.publicKey,
            ticket.id,
          ),
          unbase64(poll.result.wrappedKey),
          `relay-pair-v1:${ticket.id}`,
        ),
      ),
      sessionKey,
    );
    assert.deepEqual(
      (
        await app.inject({ url: "/api/transfers", headers: auth(remote) })
      ).json(),
      [],
    );
    assert.equal(
      (
        await app.inject({
          url: `/api/transfers/${personal.id}`,
          headers: auth(remote),
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (await app.inject({ url: "/api/devices", headers: auth(remote) }))
        .statusCode,
      403,
    );
    const bytes = Uint8Array.from({ length: 1024 }, (_, i) => i % 256);
    const upload = await put(remote, remote.id, bytes);
    assert.equal(upload.response.statusCode, 201);
    const record = transferSchema.parse(upload.response.json());
    const received = await app.inject({
      url: `/api/transfers/${record.id}`,
      headers: auth(owner),
    });
    assert.equal(received.statusCode, 200);
    assert.deepEqual(
      await open(
        sessionKey,
        new Uint8Array(received.rawPayload),
        `${transferAAD(record.id, remote.id)}:content`,
      ),
      bytes,
    );
    const retry = await app.inject({
      method: "PUT",
      url: `/api/transfers/${record.id}?scope=${remote.id}`,
      headers: {
        ...auth(remote),
        "content-type": "application/octet-stream",
        "x-relay-metadata": record.metadata,
      },
      payload: Buffer.from(upload.body),
    });
    assert.equal(retry.statusCode, 200);
    assert.equal(
      z
        .array(transferSchema)
        .parse(
          (
            await app.inject({ url: "/api/transfers", headers: auth(owner) })
          ).json(),
        ).length,
      2,
    );
    const outbound = await put(owner, remote.id, utf8("back to remote"));
    assert.equal(outbound.response.statusCode, 201);
    assert.equal(
      (
        await app.inject({
          url: `/api/transfers/${outbound.id}`,
          headers: auth(remote),
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (await put(remote, "owner", utf8("escape"))).response.statusCode,
      403,
    );
    await app.inject({
      method: "DELETE",
      url: `/api/devices/${remote.id}`,
      headers: auth(owner),
    });
    assert.equal(
      (
        await app.inject({
          url: `/api/transfers/${outbound.id}`,
          headers: auth(remote),
        })
      ).statusCode,
      401,
    );
    now += TTL + 1;
    assert.equal(
      (
        await app.inject({
          url: `/api/transfers/${personal.id}`,
          headers: auth(owner),
        })
      ).statusCode,
      404,
    );
    assert.deepEqual(
      (
        await app.inject({ url: "/api/transfers", headers: auth(owner) })
      ).json(),
      [],
    );
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("authenticated encryption rejects changed content or transfer identity", async () => {
  const key = randomKey(),
    data = await seal(key, utf8("hello"), "bound-to-item");
  assert.equal(
    new TextDecoder().decode(await open(key, data, "bound-to-item")),
    "hello",
  );
  await assert.rejects(open(key, data, "different-item"));
  data[13] = data[13]! ^ 1;
  await assert.rejects(open(key, data, "bound-to-item"));
});

test("file-size boundary and encrypted persistence across service restarts", async () => {
  const { FILE_LIMIT } = await import("../packages/protocol");
  const dir = mkdtempSync(`${tmpdir()}/relay-persistence-`);
  const options = {
    dataDir: dir,
    setupSecret: "a-test-setup-secret-at-least-24-chars",
  };
  let app = await createService(options);
  try {
    const owner = accessSchema.parse(
      (
        await app.inject({
          method: "POST",
          url: "/api/setup",
          payload: { secret: options.setupSecret, name: "Owner" },
        })
      ).json(),
    );
    const id = randomUUID(),
      key = randomKey(),
      aad = transferAAD(id, "owner");
    const payload = await seal(
      key,
      new Uint8Array(FILE_LIMIT),
      `${aad}:content`,
    );
    const headers = {
      authorization: `Bearer ${owner.token}`,
      "content-type": "application/octet-stream",
      "x-relay-metadata": base64(
        await seal(
          key,
          utf8(
            JSON.stringify({
              name: "boundary.bin",
              type: "application/octet-stream",
              kind: "file",
            }),
          ),
          `${aad}:metadata`,
        ),
      ),
    };
    assert.equal(
      (
        await app.inject({
          method: "PUT",
          url: `/api/transfers/${id}`,
          headers,
          payload: Buffer.from(payload),
        })
      ).statusCode,
      201,
    );
    assert.equal(
      (
        await app.inject({
          method: "PUT",
          url: `/api/transfers/${randomUUID()}`,
          headers,
          payload: Buffer.alloc(FILE_LIMIT + 29),
        })
      ).statusCode,
      413,
    );
    await app.close();
    app = await createService(options);
    const received = await app.inject({
      url: `/api/transfers/${id}`,
      headers: { authorization: `Bearer ${owner.token}` },
    });
    assert.equal(received.statusCode, 200);
    assert.deepEqual(received.rawPayload, Buffer.from(payload));
    assert.equal(
      (await open(key, received.rawPayload, `${aad}:content`)).length,
      FILE_LIMIT,
    );
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
