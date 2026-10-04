import { test } from "node:test";
import assert from "node:assert/strict";
import { foldGroups, groupCardId } from "./groups.ts";
import type { ArrowEdge, StepNode } from "./model.ts";

const n = (id: string, y: number, group?: string): StepNode => ({
  id,
  type: "step",
  position: { x: 0, y },
  data: { kind: "step", title: id, instructions: "", attachments: [], tags: [], ...(group ? { group } : {}) },
});
const e = (source: string, target: string): ArrowEdge => ({ id: `${source}-${target}`, source, target, data: { label: "" } });

// start → cart → pay → done, with cart and pay in "Checkout", and pay looping back to cart
const nodes = [n("start", 0), n("cart", 200, "g1"), n("pay", 400, "g1"), n("done", 600)];
const edges = [e("start", "cart"), e("cart", "pay"), e("pay", "cart"), e("pay", "done")];
const groups = [{ id: "g1", title: "Checkout" }];
const numbers = new Map([["start", 1], ["cart", 2], ["pay", 3], ["done", 4]]);

test("an open group changes nothing on the canvas", () => {
  const view = foldGroups(nodes, edges, groups, new Set(), numbers);
  assert.equal(view.nodes, nodes);
  assert.equal(view.edges, edges);
});

test("a folded group becomes one card, and arrows connect to it", () => {
  const view = foldGroups(nodes, edges, groups, new Set(["g1"]), numbers);
  const card = view.nodes.find((x) => x.id === groupCardId("g1"));
  assert.ok(card && card.type === "folded");
  assert.deepEqual(card.data.range, [2, 3]);
  assert.equal(card.data.count, 2);
  assert.ok(view.nodes.filter((x) => x.id === "cart" || x.id === "pay").every((x) => x.hidden));
  // Arrows inside the group disappear; the ones around it now meet the card.
  assert.deepEqual(
    view.edges.map((x) => `${x.source}->${x.target}`),
    ["start->group:g1", "group:g1->done"],
  );
});
