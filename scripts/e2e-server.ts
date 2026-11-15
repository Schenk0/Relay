import { createService } from "../apps/server/service";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
const dataDir = mkdtempSync(`${tmpdir()}/relay-e2e-`);
const app = await createService({
  dataDir,
  setupSecret: "relay-e2e-setup-secret-do-not-use-outside-tests",
  webRoot: path.resolve("apps/web/dist"),
});
await app.listen({ host: "127.0.0.1", port: 4319 });
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    void app.close().then(() => {
      rmSync(dataDir, { recursive: true, force: true });
      process.exit(0);
    });
  });
