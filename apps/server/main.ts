import { createService } from "./service";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
const dataDir = path.resolve(process.env.RELAY_DATA_DIR ?? "data");
mkdirSync(dataDir, { recursive: true, mode: 0o700 });
const secretPath = path.join(dataDir, "setup-secret");
if (!process.env.RELAY_SETUP_SECRET && !existsSync(secretPath))
  writeFileSync(secretPath, randomBytes(32).toString("base64url"), {
    mode: 0o600,
  });
const setupSecret =
  process.env.RELAY_SETUP_SECRET ?? readFileSync(secretPath, "utf8").trim();
if (setupSecret.length < 24)
  throw new Error("RELAY_SETUP_SECRET must contain at least 24 characters.");
const app = await createService({
  dataDir,
  setupSecret,
  webRoot: path.resolve("apps/web/dist"),
});
await app.listen({
  host: process.env.RELAY_HOST ?? "127.0.0.1",
  port: Number(process.env.PORT ?? 4318),
});
console.log(`Relay listening. Setup secret file: ${secretPath}`);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
