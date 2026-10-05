import { test } from "node:test";
import assert from "node:assert/strict";
import { arrangeByParts, foldGroups, foldedOffsets, groupCardId } from "./groups.ts";
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

// ----- Laying out by parts -----

const box = (members: StepNode[], pad = 0) => {
  const xs = members.map((m) => m.position.x);
  const ys = members.map((m) => m.position.y);
  return { x: Math.min(...xs) - pad, y: Math.min(...ys) - pad, right: Math.max(...xs) + 248 + pad, bottom: Math.max(...ys) + 112 + pad };
};
const overlaps = (a: ReturnType<typeof box>, b: ReturnType<typeof box>) =>
  !(a.right <= b.x || b.right <= a.x || a.bottom <= b.y || b.bottom <= a.y);

// Three parts of four steps each, all placed on top of each other to start with.
const part = (g: string) => Array.from({ length: 4 }, (_, i) => ({ ...n(`${g}${i}`, 0, g), position: { x: 0, y: i * 10 } }));
const messy = [...part("a"), ...part("b"), ...part("c")];
const chain = (g: string) => [0, 1, 2].map((i) => e(`${g}${i}`, `${g}${i + 1}`));
const wiring = [...chain("a"), ...chain("b"), ...chain("c"), e("a3", "b0"), e("a3", "c0")];
const parts = [{ id: "a", title: "A" }, { id: "b", title: "B" }, { id: "c", title: "C" }];

test("tidying up by parts keeps each part's frame clear of the others", () => {
  const tidy = arrangeByParts(messy, wiring, parts);
  const frames = parts.map((p) => box(tidy.filter((x) => x.data.group === p.id), 60));
  assert.ok(!overlaps(frames[0], frames[1]) && !overlaps(frames[0], frames[2]) && !overlaps(frames[1], frames[2]));
});

test("with parts folded, opening one makes room for it instead of covering the others", () => {
  const tidy = arrangeByParts(messy, wiring, parts);
  const offsets = foldedOffsets(tidy, wiring, parts, new Set(["a", "c"]), new Map());
  const shown = tidy.map((x) => ({ ...x, position: { x: x.position.x + offsets.get(x.id)!.x, y: x.position.y + offsets.get(x.id)!.y } }));
  // Part b is open; a and c are folded into single cards.
  const open = box(shown.filter((x) => x.data.group === "b"), 60);
  for (const g of ["a", "c"]) {
    const members = shown.filter((x) => x.data.group === g);
    const top = Math.min(...members.map((m) => m.position.y));
    const card = { x: box(members).x, y: top, right: box(members).right, bottom: top + 132 };
    assert.ok(!overlaps(open, card), `open part b covers folded part ${g}`);
  }
  assert.equal(foldedOffsets(tidy, wiring, parts, new Set(), new Map()).size, 0, "nothing folded, nothing moves");
});

test("inside a part, the step people reach it from comes first, even with a loop back to it", () => {
  // a0 leads into part b at b0; b2 loops back to b0.
  const nodes = [n("a0", 0), ...[0, 1, 2].map((i) => n(`b${i}`, 0, "b"))];
  const wires = [e("a0", "b0"), e("b0", "b1"), e("b1", "b2"), e("b2", "b0")];
  const tidy = arrangeByParts(nodes, wires, [{ id: "b", title: "B" }]);
  const y = (id: string) => tidy.find((x) => x.id === id)!.position.y;
  assert.ok(y("b0") < y("b1") && y("b1") < y("b2"));
});
