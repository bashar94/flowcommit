import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

/** The secret check: saving and pushing stop when passwords or keys are about to be stored in Git. */

let projectDir = "";
const git = (...args: string[]) => execFileSync("git", args, { cwd: projectDir, encoding: "utf8" });
// Put together at runtime, so this file never contains anything that looks like a real key.
const fakeKey = () => "sk-" + "proj-" + "q7Zp2Lw9Xk4Rt8Vb3Nm6Hj1Cd5Fg0Sa".repeat(2);

test.beforeEach(async ({ page, request }) => {
  const current = await (await request.get("/api/project")).json();
  const res = await request.post("/api/projects/create", {
    data: { parent: path.dirname(current.path), name: `s-${Date.now()}-${Math.floor(Math.random() * 1e6)}` },
  });
  projectDir = (await res.json()).path;
  await page.addInitScript(() => localStorage.setItem("flowcommit.tips-seen", "1"));
});

async function openWithTemplate(page: Page) {
  await page.goto("/");
  // A folder with code first offers to draw the flow from it; templates are one click away.
  const template = page.getByRole("button", { name: /Online store checkout/ });
  const describe = page.getByRole("button", { name: "Describe a new app instead" });
  await expect(template.or(describe)).toBeVisible();
  if (await describe.isVisible()) await describe.click();
  await template.click();
  await expect(page.locator(".react-flow__node-step")).toHaveCount(9);
}

async function saveVersion(page: Page, message: string) {
  await page.getByRole("button", { name: "Save version" }).click();
  const dialog = page.getByRole("dialog", { name: /Save Version/ });
  await dialog.getByRole("textbox").fill(message);
  await dialog.getByRole("button", { name: /Save Version \d/ }).click();
}

test("saving code with a key in it stops, and the file can be left out", async ({ page }) => {
  await mkdir(path.join(projectDir, "src"), { recursive: true });
  await writeFile(path.join(projectDir, "src", "ai.js"), `const client = new OpenAI({ apiKey: "${fakeKey()}" });\n`);
  await writeFile(path.join(projectDir, "src", "app.js"), "export const app = true;\n");
  await openWithTemplate(page);
  await saveVersion(page, "Store with code");

  const check = page.getByRole("dialog", { name: "Possible passwords or keys" });
  await expect(check).toContainText("src/ai.js");
  await expect(check).toContainText("OpenAI API key");
  await expect(check).not.toContainText(fakeKey(), { useInnerText: true });
  await check.getByRole("button", { name: "Save without this file" }).click();
  await expect(page.getByText(/Version 1 saved with your code, leaving out 1 file/)).toBeVisible();

  const committed = git("show", "--name-only", "--format=", "HEAD");
  expect(committed).toContain("src/app.js");
  expect(committed).not.toContain("src/ai.js");
});

test("a .env file can be kept out of Git", async ({ page }) => {
  await writeFile(path.join(projectDir, ".env"), "PORT=3000\n");
  await openWithTemplate(page);
  await saveVersion(page, "With settings");

  const check = page.getByRole("dialog", { name: "Possible passwords or keys" });
  await expect(check).toContainText("Environment file");
  await check.getByRole("button", { name: /Keep it out of Git/ }).click();
  // Checking again finds nothing, so the version saves.
  await expect(page.getByText(/Version 1 saved/)).toBeVisible();
  expect(git("check-ignore", ".env").trim()).toBe(".env");
});

test("a key pasted into a step's instructions is caught too", async ({ page }) => {
  await openWithTemplate(page);
  await page.locator(".react-flow__node-step").filter({ hasText: "Charge the card" }).click();
  await page.getByRole("textbox", { name: /Instructions for the AI builder/ }).fill(`Use this key: ${fakeKey()}`);
  await saveVersion(page, "Payment details");

  const check = page.getByRole("dialog", { name: "Possible passwords or keys" });
  await expect(check).toContainText("In the design");
  await expect(check).toContainText('in "Charge the card"');
});

test("pushing commits with a key stops until you choose to push anyway", async ({ page }) => {
  const remote = `${projectDir}-remote.git`;
  execFileSync("git", ["init", "-q", "--bare", remote]);
  git("remote", "add", "origin", remote);
  await writeFile(path.join(projectDir, "config.js"), `export const key = "${fakeKey()}";\n`);
  git("add", "config.js");
  git("-c", "user.name=E2E", "-c", "user.email=e2e@example.com", "commit", "-qm", "Add config");

  await page.goto("/");
  await page.locator(".branch-button").click();
  await page.getByRole("button", { name: "Push" }).click();
  const check = page.getByRole("dialog", { name: "Possible passwords or keys" });
  await expect(check).toContainText("config.js");
  await expect(check).toContainText("unpushed commits");

  await check.getByRole("button", { name: "Don't push" }).click();
  expect(execFileSync("git", ["--git-dir", remote, "branch"], { encoding: "utf8" }).trim()).toBe("");

  await page.locator(".branch-button").click();
  await page.getByRole("button", { name: "Push" }).click();
  await check.getByRole("button", { name: "Push anyway" }).click();
  await expect(page.getByText("Pushed to GitHub")).toBeVisible();
  expect(execFileSync("git", ["--git-dir", remote, "branch"], { encoding: "utf8" })).toMatch(/main|master/);
});
