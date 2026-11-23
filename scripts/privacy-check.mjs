import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

let denied = [];
try {
  denied = readFileSync(
    join(homedir(), ".config/relay/privacy-deny.txt"),
    "utf8",
  )
    .split(/\r?\n/)
    .filter(Boolean);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const failures = new Set();
function inspect(label, buffer) {
  if (buffer.includes(0)) return;
  const text = buffer.toString("utf8");
  if (denied.some((value) => text.toLowerCase().includes(value.toLowerCase())))
    failures.add(label);
  for (const match of text.matchAll(/[\w.+-]+@([\w.-]+\.[a-z]{2,})/gi)) {
    const domain = match[1].toLowerCase();
    if (
      !domain.endsWith("users.noreply.github.com") &&
      !/^(?:[\w-]+\.)*example\.(?:com|org)$/.test(domain) &&
      !/^icon-\d+@\d+x\.png$/.test(match[0])
    )
      failures.add(label);
  }
  if (
    /\b(?:10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])(?:\.\d{1,3}){2})\b/.test(
      text,
    )
  )
    failures.add(label);
}
if (process.argv.includes("--history")) {
  const objects = execFileSync("git", ["rev-list", "--objects", "--all"], {
    encoding: "utf8",
  })
    .trim()
    .split("\n");
  for (const line of objects) {
    const [id, ...name] = line.split(" ");
    if (
      execFileSync("git", ["cat-file", "-t", id], {
        encoding: "utf8",
      }).trim() === "blob"
    )
      inspect(
        name.join(" ") || id,
        execFileSync("git", ["cat-file", "blob", id]),
      );
  }
  inspect(
    "commit metadata",
    execFileSync("git", ["log", "--all", "--format=%an <%ae> %cn <%ce>%n%B"]),
  );
} else {
  const paths = execFileSync("git", [
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "-z",
  ])
    .toString()
    .split("\0")
    .filter(Boolean);
  for (const path of paths) {
    try {
      inspect(path, readFileSync(path));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (
      /\.(?:p12|p8|mobileprovision|sqlite|key)$/.test(path) ||
      /(?:^|\/)\.env$/.test(path)
    )
      failures.add(path);
  }
}
if (failures.size) {
  console.error(
    "Review personal information in:\n" + [...failures].sort().join("\n"),
  );
  process.exitCode = 1;
} else console.log("Privacy check passed.");
