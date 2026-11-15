import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
test("personal and remote browsers pair and transfer files both ways", async ({
  browser,
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByLabel("Device name").fill("Personal browser");
  await page
    .getByLabel("Setup secret")
    .fill("relay-e2e-setup-secret-do-not-use-outside-tests");
  await page.getByRole("button", { name: "Create inbox" }).click();
  await expect(
    page.getByRole("heading", { name: "Inbox", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Text to send").fill("Only my personal inbox");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(
    page.locator(".item-main").filter({ hasText: "Only my personal inbox" }),
  ).toBeVisible();
  const remoteContext = await browser.newContext(),
    remote = await remoteContext.newPage();
  remote.on("pageerror", (e) => errors.push(e.message));
  await remote.goto("/");
  await remote.getByLabel("Device name").fill("Remote machine");
  await remote.getByRole("button", { name: "Start temporary session" }).click();
  const code = await remote.locator(".pair-code").innerText();
  await page.getByRole("button", { name: /Connections/ }).click();
  await page.getByLabel("Pairing code").fill(code);
  await page.getByRole("button", { name: "Find device" }).click();
  await page.getByRole("button", { name: "Approve matching code" }).click();
  await expect(
    remote.getByRole("heading", { name: "Inbox", exact: true }),
  ).toBeVisible();
  await expect(
    remote.locator(".item-main").filter({ hasText: "Only my personal inbox" }),
  ).toHaveCount(0);
  const content = Buffer.from([0, 255, 127, 32, 33, 10, 70, 80, 90]);
  await remote.locator("input[type=file]").setInputFiles({
    name: "remote-file.bin",
    mimeType: "application/octet-stream",
    buffer: content,
  });
  await page.getByRole("button", { name: /Inbox/ }).click();
  await expect(
    page.getByRole("button", { name: /remote-file.bin.*left/ }),
  ).toBeVisible({ timeout: 15000 });
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save remote-file.bin" }).click();
  const download = await downloaded;
  expect(await readFile((await download.path())!)).toEqual(content);
  await page
    .getByLabel("Destination")
    .selectOption({ label: "Remote machine" });
  await page.getByLabel("Text to send").fill("Back to the remote machine");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(
    remote.getByRole("button", { name: /Back to the remote machine.*left/ }),
  ).toBeVisible({ timeout: 15000 });
  await remote
    .getByRole("button", { name: /Back to the remote machine.*left/ })
    .click();
  await expect(remote.getByRole("dialog")).toContainText(
    "Back to the remote machine",
  );
  await remote.getByLabel("Close preview").click();
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7S8AAAAASUVORK5CYII=",
    "base64",
  );
  await remote.locator("input[type=file]").setInputFiles({
    name: "shared-image.png",
    mimeType: "image/png",
    buffer: png,
  });
  await expect(
    page.locator(".item-main").filter({ hasText: "shared-image.png" }),
  ).toBeVisible({ timeout: 15000 });
  await page
    .locator(".item-main")
    .filter({ hasText: "shared-image.png" })
    .click();
  await expect(
    page.getByRole("dialog").getByRole("img", { name: "shared-image.png" }),
  ).toBeVisible();
  await page.getByLabel("Close preview").click();
  await page.getByLabel("Destination").selectOption("owner");
  await page.getByLabel("Text to send").fill("Offline queued text");
  await page.context().setOffline(true);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText("1 queued")).toBeVisible();
  await page.context().setOffline(false);
  await expect(
    page.getByRole("button", { name: /Offline queued text.*left/ }),
  ).toBeVisible({ timeout: 15000 });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "Add files" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: /Connections/ }).click();
  await page
    .locator(".device")
    .filter({ hasText: "Remote machine" })
    .getByRole("button", { name: "Revoke" })
    .click();
  await remote.getByLabel("Refresh inbox").click();
  await expect(remote.getByRole("alert")).toContainText("revoked");
  expect(errors).toEqual([]);
  await remoteContext.close();
});
