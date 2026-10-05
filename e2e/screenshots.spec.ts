import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

/**
 * Takes the README's screenshots, in light and dark. Not part of the normal test run:
 * npm run screenshots
 */

test.skip(!process.env.SCREENSHOTS, "Only runs with npm run screenshots");
test.use({ viewport: { width: 1360, height: 820 }, deviceScaleFactor: 2 });

const OUT = path.resolve(import.meta.dirname, "../docs/images");
let projectDir = "";

test.beforeEach(async ({ page, request }) => {
  const current = await (await request.get("/api/project")).json();
  const res = await request.post("/api/projects/create", {
    data: { parent: path.dirname(current.path), name: `shot-${Date.now()}` },
  });
  projectDir = (await res.json()).path;
  await page.addInitScript(() => {
    localStorage.setItem("flowcommit.tips-seen", "1");
    if (!sessionStorage.getItem("shot")) {
      localStorage.setItem("flowcommit.view", "{}"); // start every screenshot from the Detailed view
      sessionStorage.setItem("shot", "1");
    }
  });
});

const card = (page: Page, title: string) => page.locator(".react-flow__node-step").filter({ hasText: title }).first();

async function startStore(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Online store checkout/ }).click();
  await expect(page.locator(".react-flow__node-step")).toHaveCount(9);
  await page.waitForTimeout(800); // the layout settles once the cards are measured
}

/** Marks some steps as built and one as being built, the way an AI agent would. */
async function pretendBuilt(built: string[], building: string) {
  const flow = JSON.parse(await readFile(path.join(projectDir, ".flowcommit", "flow.json"), "utf8"));
  const steps: Record<string, unknown> = {};
  for (const n of flow.nodes) {
    const state = built.includes(n.title) ? "built" : n.title === building ? "building" : null;
    if (!state) continue;
    steps[n.id] = {
      state,
      note: "",
      files: [],
      fileHashes: {},
      agent: "Claude Code",
      updatedAt: new Date().toISOString(),
      builtSpec: { kind: n.kind, title: n.title, instructions: n.instructions, attachments: [], tags: n.tags },
    };
  }
  await writeFile(path.join(projectDir, ".flowcommit", "status.json"), JSON.stringify({ schema: 1, steps }));
}

/** Reloads (which clears notifications and zooms to the whole flow), then shoots light and dark. */
async function shoot(page: Page, name: string, after?: () => Promise<void>) {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.reload();
    await expect(page.locator(".react-flow__node").first()).toBeVisible();
    await page.waitForTimeout(800);
    await after?.();
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(OUT, `${name}-${scheme}.png`) });
  }
}

test("editor", async ({ page }) => {
  await startStore(page);
  await card(page, "Cart").click();
  await card(page, "Checkout form").click({ modifiers: ["ControlOrMeta"] });
  await card(page, "Charge the card").click({ modifiers: ["ControlOrMeta"] });
  await page.keyboard.press("ControlOrMeta+g");
  const name = page.getByRole("textbox", { name: "Group name" });
  await name.fill("Checkout");
  await name.press("Enter");
  await pretendBuilt(["Shopper lands on store", "Product list", "Cart", "Checkout form"], "Charge the card");
  await expect(card(page, "Cart")).toContainText("Built");
  await shoot(page, "editor", () => card(page, "Charge the card").click());
});

test("history", async ({ page }) => {
  await startStore(page);
  await page.getByRole("button", { name: "Save version" }).click();
  await page.getByRole("dialog").getByRole("textbox").fill("First draft of the store");
  await page.getByRole("dialog").getByRole("button", { name: /Save Version 1/ }).click();
  await expect(page.getByText("Version 1 saved")).toBeVisible();

  // Change the design: new instructions, a new step, and one step removed.
  await card(page, "Charge the card").click();
  await page
    .getByRole("textbox", { name: /Instructions for the AI builder/ })
    .fill("Create the payment with Stripe. Never store card numbers. Show Apple Pay and Google Pay when the browser supports them.");
  await card(page, "Cart").click();
  await page.keyboard.press("Tab");
  await page.getByRole("textbox", { name: "Title" }).fill("Apply a discount code");
  await card(page, "Payment failed").click();
  await page.getByRole("button", { name: "Delete step" }).click();
  await expect(card(page, "Payment failed")).toHaveCount(0);
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "Save version" }).click();
  await page.getByRole("dialog").getByRole("textbox").fill("Discount codes and wallet payments");
  await page.getByRole("dialog").getByRole("button", { name: /Save Version 2/ }).click();
  await expect(page.getByText("Version 2 saved")).toBeVisible();

  await shoot(page, "history", async () => {
    await page.getByRole("tab", { name: /History/ }).click();
    await expect(page.getByText("Discount codes and wallet payments").first()).toBeVisible();
    await page.waitForTimeout(800);
    await page.locator(".compare .react-flow__controls-fitview, .react-flow__controls-fitview").first().click();
  });
});

test("simple view", async ({ page }) => {
  await startStore(page);
  await page.getByRole("button", { name: /^View/ }).click();
  await page.getByRole("button", { name: "Simple" }).click();
  await page.keyboard.press("Escape");
  await shoot(page, "simple");
});
