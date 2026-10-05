import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";

/** Plugins: templates from a folder (the open example plugin), a share option, a builder and events. */

const events = () =>
  readFile(path.join(os.tmpdir(), `flowcommit-e2e-${process.env.E2E_PORT ?? "4368"}`, "events.log"), "utf8").catch(() => "");

test.beforeEach(async ({ page, request }) => {
  const current = await (await request.get("/api/project")).json();
  await request.post("/api/projects/create", {
    data: { parent: path.dirname(current.path), name: `pl-${Date.now()}-${Math.floor(Math.random() * 1e6)}` },
  });
  await page.addInitScript(() => localStorage.setItem("flowcommit.tips-seen", "1"));
  await page.goto("/");
});

test("FlowCommit lists the plugins it loaded", async ({ request }) => {
  const info = await (await request.get("/api/plugins")).json();
  expect(info.plugins.map((p: { name: string; error?: string }) => [p.name, p.error ?? null])).toEqual([
    ["local-templates", null],
    ["e2e", null],
  ]);
});

test("a template from a plugin starts a new flow", async ({ page }) => {
  await expect(page.getByText("Your templates")).toBeVisible();
  await page.getByRole("button", { name: /Newsletter sign-up/ }).click();
  await expect(page.locator(".react-flow__node-step")).toHaveCount(3);
  await expect(page.locator(".react-flow__node-step").filter({ hasText: "Sign-up form" })).toBeVisible();
  await expect.poll(events).toContain("flowSaved");
});

test("a plugin's share option and builder can be used", async ({ page }) => {
  await page.getByRole("button", { name: /Online store checkout/ }).click();
  await page.getByRole("button", { name: /^View/ }).click();
  await page.getByRole("button", { name: "Share a test link" }).click();
  await expect(page.getByText(/Shared 9 steps\. https:\/\/example\.com\/share\//)).toBeVisible();

  await page.getByRole("button", { name: /^Build/ }).click();
  await page.getByRole("tab", { name: "Test cloud" }).click();
  await page.getByRole("button", { name: "Build with Test cloud" }).click();
  await expect(page.getByText("Started building Online store.")).toBeVisible();
});
