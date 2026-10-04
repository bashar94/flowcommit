import { test } from "node:test";
import assert from "node:assert/strict";
import { arrowTone, decisionSide, outline, readingNumbers, related } from "./flowView.ts";

const n = (id: string, x: number, y: number, kind = "step") => ({ id, position: { x, y }, data: { kind, title: id } });
const e = (source: string, target: string, label = "") => ({ id: `${source}-${target}`, source, target, data: { label } });

// start → form → pay → (Yes) save → done, (No) failed → back to form
const nodes = [n("start", 0, 0, "start"), n("form", 0, 200), n("pay", 0, 400, "decision"), n("save", -200, 600), n("failed", 200, 600), n("done", 0, 800, "end")];
const edges = [e("start", "form"), e("form", "pay"), e("pay", "save", "Yes"), e("pay", "failed", "No"), e("failed", "form", "Try again"), e("save", "done")];

test("steps are numbered top to bottom, then left to right", () => {
  const nums = readingNumbers(nodes);
  assert.deepEqual(["start", "form", "pay", "save", "failed", "done"].map((id) => nums.get(id)), [1, 2, 3, 4, 5, 6]);
});

test("highlighting a branch doesn't light up the other branch", () => {
  const r = related("save", nodes, edges);
  assert.ok(r.nodes.has("start") && r.nodes.has("done"));
  assert.ok(!r.nodes.has("failed"));
});

test("the outline indents branches and shows loops as going back", () => {
  const items = outline(nodes, edges, readingNumbers(nodes));
  assert.deepEqual(
    items.map((i) => `${"  ".repeat(i.depth)}${i.type === "goto" ? (i.back ? "back to " : "continues at ") : ""}${i.id}${i.via ? ` (${i.via})` : ""}`),
    ["start", "form", "pay", "  save (Yes)", "  done", "  failed (No)", "  back to form (Try again)"],
  );
});

test("branch labels get colors", () => {
  assert.equal(arrowTone("Yes"), "yes");
  assert.equal(arrowTone("Payment failed"), "plain");
  assert.equal(arrowTone("No"), "no");
  assert.equal(arrowTone("Failed"), "no");
});

test("a decision's arrow leaves from the side its target is on", () => {
  const diamond = { position: { x: 0 }, measured: { width: 260 } };
  const at = (x: number) => ({ position: { x }, measured: { width: 248 } });
  assert.equal(decisionSide(diamond, at(-300), false), "left");
  assert.equal(decisionSide(diamond, at(300), false), "right");
  // Directly below the diamond, the arrow goes straight down, not out of a corner.
  assert.equal(decisionSide(diamond, at(10), false), undefined);
  assert.equal(decisionSide(diamond, at(10), true), "right");
});
