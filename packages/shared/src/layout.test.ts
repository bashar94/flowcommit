import { test } from "node:test";
import assert from "node:assert/strict";
import { LAYOUT, layoutFlow } from "./layout.ts";

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
