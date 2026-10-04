import { test } from "node:test";
import assert from "node:assert/strict";
import { layoutGraph } from "./graph.ts";

test("a straight history stays in one lane", () => {
  const { placed, lanes } = layoutGraph([
    { sha: "c", parents: ["b"] },
    { sha: "b", parents: ["a"] },
    { sha: "a", parents: [] },
  ]);
  assert.deepEqual(placed.map((c) => c.lane), [0, 0, 0]);
  assert.equal(lanes, 1);
});

test("two branches from one commit get their own lanes, then join", () => {
  // main: a - b - d(merge)      feature: a - c
  const { placed, lines } = layoutGraph([
    { sha: "d", parents: ["b", "c"] },
    { sha: "c", parents: ["a"] },
    { sha: "b", parents: ["a"] },
    { sha: "a", parents: [] },
  ]);
  const lane = Object.fromEntries(placed.map((c) => [c.sha, c.lane]));
  assert.equal(lane.d, 0);
  assert.equal(lane.b, 0);
  assert.notEqual(lane.c, 0);
  assert.equal(lane.a, 0);
  assert.equal(lines.filter((l) => l.merge).length, 1);
});

test("branch tips that aren't merged keep separate lanes", () => {
  const { placed } = layoutGraph([
    { sha: "b2", parents: ["a"] },
    { sha: "x1", parents: ["a"] },
    { sha: "a", parents: [] },
  ]);
  assert.notEqual(placed[0].lane, placed[1].lane);
  assert.equal(placed[2].lane, placed[0].lane);
});
