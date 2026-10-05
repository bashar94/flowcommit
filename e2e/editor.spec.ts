import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

/**
 * The editor end to end: each test gets a brand new project (a fresh Git repository), starts
 * from a template, and checks what a person would see.
 */

let projectDir = "";

test.beforeEach(async ({ page, request }) => {
  const current = await (await request.get("/api/project")).json();
  const res = await request.post("/api/projects/create", {
    data: { parent: path.dirname(current.path), name: `p-${Date.now()}-${Math.floor(Math.random() * 1e6)}` },
  });
  expect(res.ok()).toBeTruthy();
  projectDir = (await res.json()).path;
  // The first-run tips would cover the canvas in every test.
  await page.addInitScript(() => localStorage.setItem("flowcommit.tips-seen", "1"));
  await page.goto("/");
});

const cards = (page: Page) => page.locator(".react-flow__node-step:not(.hidden)");
const card = (page: Page, title: string) => cards(page).filter({ hasText: title }).first();

async function startFromStoreTemplate(page: Page) {
  await page.getByRole("button", { name: /Online store checkout/ }).click();
  await expect(cards(page)).toHaveCount(9);
}

async function flowOnDisk() {
  return JSON.parse(await readFile(path.join(projectDir, ".flowcommit", "flow.json"), "utf8"));
}

test("a template draws its steps and is saved to the project", async ({ page }) => {
  await startFromStoreTemplate(page);
  await expect(card(page, "Payment succeeded?")).toBeVisible();
  await expect.poll(async () => (await flowOnDisk()).nodes.length).toBe(9);
});

test("saving a version shows it in History", async ({ page }) => {
  await startFromStoreTemplate(page);
  await page.getByRole("button", { name: "Save version" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox").fill("First draft of the store");
  await dialog.getByRole("button", { name: /Save Version 1/ }).click();
  await expect(page.getByText("Version 1 saved")).toBeVisible();

  await page.getByRole("tab", { name: /History/ }).click();
  await expect(page.getByText("First draft of the store").first()).toBeVisible();
});

test("Tab adds the next step, and undo and redo work on the canvas", async ({ page }) => {
  await startFromStoreTemplate(page);
  await card(page, "Cart").click();
  await page.keyboard.press("Tab");
  await expect(cards(page)).toHaveCount(10);

  // Leave the new step's title box, so the shortcut undoes the design rather than the typing.
  await page.locator(".react-flow__pane").click({ position: { x: 40, y: 40 } });
  await page.waitForTimeout(500);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(cards(page)).toHaveCount(9);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(cards(page)).toHaveCount(10);
});

test("finding a step selects it", async ({ page }) => {
  await startFromStoreTemplate(page);
  await page.locator(".react-flow__pane").click({ position: { x: 40, y: 40 } });
  await page.keyboard.press("ControlOrMeta+f");
  await page.getByRole("textbox", { name: "Find a step" }).fill("checkout form");
  await page.keyboard.press("Enter");
  await expect(page.locator(".react-flow__node.selected")).toContainText("Checkout form");
});

test("duplicating a step adds a copy", async ({ page }) => {
  await startFromStoreTemplate(page);
  await card(page, "Cart").click();
  await page.keyboard.press("ControlOrMeta+d");
  await expect(cards(page).filter({ hasText: "Cart" })).toHaveCount(2);
  await expect(page.getByText("Duplicated 1 step")).toBeVisible();
});

test("steps can be grouped, folded into one card and opened again", async ({ page }) => {
  await startFromStoreTemplate(page);
  await card(page, "Cart").click();
  await page.keyboard.press("ControlOrMeta+g");
  const name = page.getByRole("textbox", { name: "Group name" });
  await name.fill("Checkout");
  await name.press("Enter");
  await expect(page.locator(".group-frame")).toContainText("Checkout");
  await expect.poll(async () => (await flowOnDisk()).groups?.[0]?.title).toBe("Checkout");

  await page.getByRole("button", { name: "Fold Checkout" }).click();
  await expect(page.locator(".group-card")).toContainText("1 step");
  await expect(card(page, "Cart")).toHaveCount(0);

  await page.locator(".group-card-body").click();
  await expect(card(page, "Cart")).toBeVisible();
});

test("the View menu's Simple preset hides instructions on the cards", async ({ page }) => {
  await startFromStoreTemplate(page);
  const instructions = card(page, "Cart").getByText("running total");
  await expect(instructions).toBeVisible();
  await page.getByRole("button", { name: /^View/ }).click();
  await page.getByRole("button", { name: "Simple" }).click();
  await expect(instructions).toBeHidden();
  await page.getByRole("button", { name: "Detailed" }).click();
  await expect(instructions).toBeVisible();
});

test("a project with code can be drawn from its code, with those steps marked built", async ({ page }) => {
  // Some existing code, and a stand-in for the AI's answer so the test doesn't need an AI tool.
  await mkdir(path.join(projectDir, "src"), { recursive: true });
  await writeFile(path.join(projectDir, "src", "notes.js"), "export const notes = [];\n");
  const steps = ["Open the app", "Notes list", "Add a note", "Save notes", "Delete a note", "Done"];
  await page.route("**/api/ai/import", (route) =>
    route.fulfill({
      json: {
        name: "Notes",
        description: "A small notes app.",
        steps: steps.map((title, i) => ({
          id: `s${i}`,
          kind: i === 0 ? "start" : i === steps.length - 1 ? "end" : i === 3 ? "data" : "screen",
          title,
          instructions: "",
          files: i === 0 || i === steps.length - 1 ? [] : ["src/notes.js"],
          ...(title === "Notes list" ? { codeRef: "/notes", uses: ["IndexedDB"] } : {}),
          done: title !== "Delete a note",
        })),
        arrows: steps.slice(1).map((_, i) => ({ from: `s${i}`, to: `s${i + 1}`, label: "" })),
      },
    }),
  );
  // Act as if Claude Code is installed, as it won't be on a CI machine.
  await page.route("**/api/ai", (route) =>
    route.fulfill({
      json: { providers: [{ id: "claude", label: "Claude Code", available: true, version: "test", install: "" }] },
    }),
  );
  await page.reload();
  await page.getByRole("button", { name: "Draw it from my code" }).click();
  await expect(cards(page)).toHaveCount(6);
  await expect(card(page, "Notes list")).toContainText("Built");
  // What the AI found in the code shows on the card for developers.
  await expect(card(page, "Notes list").locator(".step-dev")).toHaveText("/notesIndexedDB");
  await expect(card(page, "Delete a note")).not.toContainText("Built");
  // The view zooms out to show every step.
  for (const title of steps) await expect(card(page, title)).toBeInViewport();
});

test("developer details: one quiet line on the card, hidden in Simple, and searchable", async ({ page }) => {
  await startFromStoreTemplate(page);
  const pay = card(page, "Charge the card");
  await pay.click();
  await page.getByText("For developers").click();
  await page.getByRole("textbox", { name: "Endpoint" }).fill("POST /api/checkout");
  const uses = page.getByRole("combobox", { name: "Uses" }).or(page.getByRole("textbox", { name: "Uses" }));
  for (const s of ["Stripe", "Postgres", "Zod"]) {
    await uses.fill(s);
    await uses.press("Enter");
  }
  await page.getByRole("textbox", { name: "Rules the code must follow" }).fill("Charge in the shopper's currency");

  // One line: the endpoint and a service, with the rest counted.
  const line = pay.locator(".step-dev");
  await expect(line).toHaveText("POST /api/checkoutStripe+2");
  await expect(pay).not.toContainText("shopper's currency");
  await expect.poll(async () => (await flowOnDisk()).nodes.find((n: { title: string }) => n.title === "Charge the card")).toMatchObject({
    codeRef: "POST /api/checkout",
    uses: ["Stripe", "Postgres", "Zod"],
    rules: ["Charge in the shopper's currency"],
  });

  await page.getByRole("button", { name: /^View/ }).click();
  await page.getByRole("button", { name: "Simple" }).click();
  await expect(line).toBeHidden();
  await page.getByRole("button", { name: "Detailed" }).click();
  await page.keyboard.press("Escape");

  await page.locator(".react-flow__pane").click({ position: { x: 40, y: 40 } });
  await page.keyboard.press("ControlOrMeta+f");
  await page.getByRole("textbox", { name: "Find a step" }).fill("zod");
  await page.keyboard.press("Enter");
  await expect(page.locator(".react-flow__node.selected")).toContainText("Charge the card");
});
