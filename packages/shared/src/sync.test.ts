import { test } from "node:test";
import assert from "node:assert/strict";
import { createEmptyFlow, type FlowFile, type FlowNode } from "./flow.ts";
import { specOf, type BuildStatus } from "./build.ts";
import { applySuggestion, pendingChanges, pendingSummary, type Suggestion } from "./sync.ts";

const step = (id: string, patch: Partial<FlowNode> = {}): FlowNode => ({
  id,
  kind: "step",
  title: id,
  instructions: "",
  attachments: [],
  tags: [],
  position: { x: 0, y: 0 },
  ...patch,
});
const flow: FlowFile = { ...createEmptyFlow("t"), nodes: [step("cart", { title: "Cart" }), step("pay", { title: "Pay" })], edges: [{ id: "1", source: "cart", target: "pay", label: "" }] };
let n = 0;
const newId = (p: string) => `${p}-${++n}`;
const suggestion = (change: Suggestion["change"]): Suggestion => ({ id: "s", createdAt: "", source: "Claude Code", reason: "", files: [], change });

test("accepting an added step connects it where the agent said", () => {
  const r = applySuggestion(flow, suggestion({ type: "add-step", step: { kind: "screen", title: "Login", instructions: "", tags: [] }, after: "cart", before: "pay", label: "Not signed in" }), newId);
  assert.ok("flow" in r);
  const login = r.flow.nodes.find((x) => x.title === "Login")!;
  assert.ok(r.flow.edges.some((e) => e.source === "cart" && e.target === login.id && e.label === "Not signed in"));
  assert.ok(r.flow.edges.some((e) => e.source === login.id && e.target === "pay"));
});

test("a suggestion about a deleted step is refused", () => {
  const r = applySuggestion(flow, suggestion({ type: "edit-step", stepId: "gone", title: "x" }), newId);
  assert.ok("error" in r);
});

test("steps deleted after being built are reported, so their code can go", () => {
  const built = (node: FlowNode): BuildStatus["steps"][string] => ({ state: "built", note: "", files: ["src/old.ts"], fileHashes: {}, agent: "", updatedAt: "", builtSpec: specOf(node) });
  const status: BuildStatus = { schema: 1, steps: { cart: built(flow.nodes[0]), old: built(step("old", { title: "Old login" })) } };
  const p = pendingChanges(flow, status);
  assert.deepEqual(p.removed, [{ id: "old", title: "Old login", files: ["src/old.ts"] }]);
  assert.deepEqual(p.added.map((x) => x.id), ["pay"]);
  assert.match(pendingSummary(p), /removed from the design \("Old login"\)/);
});

test("nothing pending means no summary", () => {
  assert.equal(pendingSummary({ changed: [], added: [], removed: [], blocked: [] }), "");
});

test("adding to a step's instructions keeps the person's wording", () => {
  const withText: FlowFile = { ...flow, nodes: [step("cart", { title: "Cart", instructions: "List items with totals." }), flow.nodes[1]] };
  const r = applySuggestion(withText, suggestion({ type: "edit-step", stepId: "cart", addInstructions: "Includes a coupon field." }), newId);
  assert.ok("flow" in r);
  assert.equal(r.flow.nodes[0].instructions, "List items with totals.\n\nIncludes a coupon field.");
});
