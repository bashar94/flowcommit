import { test } from "node:test";
import assert from "node:assert/strict";
import { LAYOUT, layoutBlocks, layoutFlow } from "./layout.ts";

const rowOf = (pos: Map<string, { y: number }>, id: string) => pos.get(id)!.y / LAYOUT.rowHeight;

test("a straight flow goes down one row per step", () => {
  const pos = layoutFlow(["a", "b", "c"], [
    { source: "a", target: "b" },
    { source: "b", target: "c" },
  ]);
  assert.deepEqual(["a", "b", "c"].map((id) => rowOf(pos, id)), [0, 1, 2]);
  assert.equal(pos.get("a")!.x, pos.get("c")!.x);
});

test("an arrow that loops back doesn't push steps down", () => {
  const pos = layoutFlow(
    ["start", "form", "pay", "failed", "done"],
    [
      { source: "start", target: "form" },
      { source: "form", target: "pay" },
      { source: "pay", target: "failed" },
      { source: "pay", target: "done" },
      { source: "failed", target: "form" },
    ],
    ["start"],
  );
  assert.equal(rowOf(pos, "start"), 0);
  assert.equal(rowOf(pos, "form"), 1);
  assert.equal(rowOf(pos, "pay"), 2);
  assert.equal(rowOf(pos, "failed"), 3);
  assert.equal(rowOf(pos, "done"), 3);
});

test("a step is placed below every step that leads into it", () => {
  const pos = layoutFlow(["s", "a", "b", "join"], [
    { source: "s", target: "a" },
    { source: "a", target: "b" },
    { source: "s", target: "join" },
    { source: "b", target: "join" },
  ]);
  assert.equal(rowOf(pos, "join"), 3);
});

test("steps in the same row don't overlap", () => {
  const pos = layoutFlow(["d", "yes", "no"], [
    { source: "d", target: "yes" },
    { source: "d", target: "no" },
  ]);
  assert.ok(Math.abs(pos.get("yes")!.x - pos.get("no")!.x) >= LAYOUT.cardWidth);
});

test("a tall card pushes the next row down", () => {
  const pos = layoutFlow(["a", "b"], [{ source: "a", target: "b" }], [], new Map([["a", 400]]));
  assert.equal(pos.get("b")!.y, 400 + LAYOUT.rowGap);
});

test("steps in the same group are placed side by side", () => {
  // start leads to four steps; a and c are in one group, so b mustn't land between them.
  const ids = ["start", "a", "b", "c", "d"];
  const edges = ids.slice(1).map((id) => ({ source: "start", target: id }));
  const pos = layoutFlow(ids, edges, ["start"], new Map(), new Map([["a", "g"], ["c", "g"]]));
  const order = ids.slice(1).sort((x, y) => pos.get(x)!.x - pos.get(y)!.x);
  const ia = order.indexOf("a");
  const ic = order.indexOf("c");
  assert.equal(Math.abs(ia - ic), 1, `a and c should be neighbors, got ${order.join(" ")}`);
});

test("blocks of different sizes never overlap, and line up under what leads into them", () => {
  const sizes = new Map([
    ["a", { width: 248, height: 120 }],
    ["big", { width: 900, height: 600 }],
    ["c", { width: 248, height: 120 }],
    ["d", { width: 400, height: 300 }],
  ]);
  const pos = layoutBlocks(["a", "big", "c", "d"], [
    { source: "a", target: "big" },
    { source: "a", target: "c" },
    { source: "big", target: "d" },
  ], ["a"], sizes);
  const boxes = [...pos].map(([id, p]) => ({ id, ...p, ...sizes.get(id)! }));
  for (const x of boxes)
    for (const y of boxes) {
      if (x.id >= y.id) continue;
      const apart = x.x + x.width <= y.x || y.x + y.width <= x.x || x.y + x.height <= y.y || y.y + y.height <= x.y;
      assert.ok(apart, `${x.id} and ${y.id} overlap`);
    }
  assert.ok(pos.get("big")!.y > pos.get("a")!.y && pos.get("d")!.y > pos.get("big")!.y);
});
