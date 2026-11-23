import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { configPath, localConfig } from "./local-config.mjs";

const env = localConfig();
const [command, ...args] = process.argv.slice(2);
function run(program, parameters) {
  const result = spawnSync(program, parameters, { env, stdio: "inherit" });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
if (command === "apple") {
  if (!/^[A-Za-z0-9]+(?:\.[A-Za-z0-9-]+)+$/.test(env.RELAY_BUNDLE_ID_PREFIX))
    throw new Error("RELAY_BUNDLE_ID_PREFIX must be a reverse-DNS identifier.");
  if (env.RELAY_APPLE_TEAM && !/^[A-Z0-9]{10}$/.test(env.RELAY_APPLE_TEAM))
    throw new Error("RELAY_APPLE_TEAM must be a ten-character Apple team ID.");
  const server = new URL(env.RELAY_DEFAULT_SERVER);
  if (
    server.protocol !== "https:" &&
    !(
      server.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(server.hostname)
    )
  )
    throw new Error("Use HTTPS for a remote Relay server.");
  run("xcodegen", ["generate", "--spec", "apps/apple/project.yml", ...args]);
} else if (command === "compose") {
  run("docker", [
    "compose",
    "--env-file",
    configPath,
    "-f",
    "compose.tailnet.yaml",
    ...args,
  ]);
} else if (command === "gateway") {
  const output = args[0];
  if (!output)
    throw new Error(
      "Specify an output file outside the repository for the private gateway configuration.",
    );
  let text = readFileSync("deploy/relay-public.caddy", "utf8");
  text = text.replace(/\{\$(RELAY_[A-Z_]+)\}/g, (_, key) => {
    const value = env[key];
    if (!value || /[\s{};"\\]/.test(value))
      throw new Error(`Set a valid ${key} in the private configuration.`);
    return value;
  });
  writeFileSync(resolve(output), text, { mode: 0o600 });
  console.log("Private gateway configuration rendered.");
} else if (command === "config") {
  console.log(`Configuration: ${configPath}`);
  console.log(
    `Apple signing: ${env.RELAY_APPLE_TEAM ? "configured" : "not configured"}`,
  );
  console.log(
    `Server default: ${env.RELAY_DEFAULT_SERVER === "http://127.0.0.1:4318" ? "loopback" : "custom"}`,
  );
} else {
  throw new Error("Use apple, compose, gateway, or config.");
}
