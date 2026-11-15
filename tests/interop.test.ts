import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import {
  base64,
  unbase64,
  createPairKey,
  pairingKey,
  randomKey,
  seal,
  open,
  utf8,
} from "../packages/protocol/crypto";
import { z } from "zod";
test("Swift CryptoKit and Web Crypto exchange ciphertext and P-256 pairing keys", async () => {
  const dir = mkdtempSync(`${tmpdir()}/relay-interop-`);
  try {
    const a = await createPairKey(),
      b = await createPairKey(),
      key = randomKey(),
      aad = "relay-test-interop";
    const fixture = {
      key,
      aad,
      plaintext: base64(
        utf8("An image filename 🐈 and binary bytes \u0000\u00ff"),
      ),
      ciphertext: base64(
        await seal(
          key,
          utf8("An image filename 🐈 and binary bytes \u0000\u00ff"),
          aad,
        ),
      ),
      privateKey: base64(
        new Uint8Array(await crypto.subtle.exportKey("pkcs8", a.privateKey)),
      ),
      publicKey: b.publicKey,
      pairId: "test-pair",
      derived: await pairingKey(a.privateKey, b.publicKey, "test-pair"),
    };
    // CryptoKit accepts SEC1 raw private scalars; extract the JWK scalar for the fixture.
    const jwk = await crypto.subtle.exportKey("jwk", a.privateKey);
    assert.ok(jwk.d);
    fixture.privateKey = base64(
      Uint8Array.from(Buffer.from(jwk.d, "base64url")),
    );
    const input = `${dir}/input.json`,
      output = `${dir}/output.json`;
    writeFileSync(input, JSON.stringify(fixture));
    const result = spawnSync(
      "swift",
      ["test", "--package-path", "apps/apple"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          RELAY_INTEROP_INPUT: input,
          RELAY_INTEROP_OUTPUT: output,
        },
        timeout: 120000,
      },
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const swift = z
      .object({ ciphertext: z.string() })
      .parse(JSON.parse(readFileSync(output, "utf8")) as unknown);
    assert.equal(
      base64(await open(key, unbase64(swift.ciphertext), aad)),
      fixture.plaintext,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
