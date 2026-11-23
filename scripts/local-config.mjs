import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";

export const configPath =
  process.env.RELAY_CONFIG_FILE ?? join(homedir(), ".config/relay/local.env");
export function localConfig() {
  let saved = {};
  try {
    saved = parseEnv(readFileSync(configPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return {
    RELAY_APPLE_TEAM: "",
    RELAY_BUNDLE_ID_PREFIX: "org.example.relay",
    RELAY_DEFAULT_SERVER: "http://127.0.0.1:4318",
    ...saved,
    ...process.env,
  };
}
