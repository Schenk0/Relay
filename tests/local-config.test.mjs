import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

test("private configuration is optional, parsed as data, and environment overrides it", () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-config-"));
  const file = join(dir, "local.env");
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("RELAY_")),
  );
  const read = (extra = {}) => {
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        'import {localConfig} from "./scripts/local-config.mjs";const e=localConfig();console.log(JSON.stringify([e.RELAY_APPLE_TEAM,e.RELAY_BUNDLE_ID_PREFIX,e.RELAY_DEFAULT_SERVER]));',
      ],
      { env: { ...env, RELAY_CONFIG_FILE: file, ...extra }, encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  try {
    assert.deepEqual(read(), [
      "",
      "org.example.relay",
      "http://127.0.0.1:4318",
    ]);
    writeFileSync(
      file,
      'RELAY_APPLE_TEAM=ABCDEFGHIJ\nRELAY_BUNDLE_ID_PREFIX=org.example.personal\nRELAY_DEFAULT_SERVER="https://relay.example.com"\n',
    );
    assert.deepEqual(read(), [
      "ABCDEFGHIJ",
      "org.example.personal",
      "https://relay.example.com",
    ]);
    assert.equal(read({ RELAY_APPLE_TEAM: "KLMNOPQRST" })[0], "KLMNOPQRST");
    writeFileSync(file, 'RELAY_DEFAULT_SERVER="$(exit 42)"\n');
    assert.equal(read()[2], "$(exit 42)");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
