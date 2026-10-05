import { test } from "node:test";
import assert from "node:assert/strict";
import { createEmptyFlow, parseFlow, serializeFlow, type FlowFile, type FlowNode } from "./flow.ts";
import { diffFlows, diffWords, hasDesignChanges, suggestMessage, summarizeDiff } from "./diff.ts";

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

const flow = (nodes: FlowNode[], edges: FlowFile["edges"] = []): FlowFile => ({
  ...createEmptyFlow("test"),
  nodes,
  edges,
});

test("first version reports every step as added", () => {
  const d = diffFlows(null, flow([step("a"), step("b")], [{ id: "e1", source: "a", target: "b", label: "" }]));
  assert.equal(d.stats.stepsAdded, 2);
  assert.equal(d.stats.arrowsAdded, 1);
  assert.equal(summarizeDiff(d.stats), "2 steps added, 1 arrow added");
});

test("detects added, removed and changed steps", () => {
  const before = flow([step("a"), step("b"), step("c", { title: "Old" })]);
  const after = flow([step("a"), step("c", { title: "New" }), step("d")]);
  const d = diffFlows(before, after);
  const byId = Object.fromEntries(d.nodes.map((n) => [n.id, n]));
  assert.equal(byId.a.status, "unchanged");
  assert.equal(byId.b.status, "removed");
  assert.equal(byId.d.status, "added");
  assert.equal(byId.c.status, "changed");
  assert.deepEqual(byId.c.status === "changed" && byId.c.fields, ["title"]);
});

test("moving a card is not a design change", () => {
  const before = flow([step("a")]);
  const after = flow([step("a", { position: { x: 300, y: 40 } })]);
  const d = diffFlows(before, after);
  assert.equal(d.stats.stepsMoved, 1);
  assert.equal(hasDesignChanges(d.stats), false);
  assert.equal(summarizeDiff(d.stats), "1 step moved");
});

test("a redrawn arrow with a new id is the same arrow", () => {
  const before = flow([step("a"), step("b")], [{ id: "e1", source: "a", target: "b", label: "Yes" }]);
  const after = flow([step("a"), step("b")], [{ id: "e2", source: "a", target: "b", label: "No" }]);
  const d = diffFlows(before, after);
  assert.equal(d.edges.length, 1);
  assert.equal(d.edges[0].status, "changed");
});

test("word diff marks only the changed words", () => {
  const changes = diffWords("Show an error message", "Show a friendly error message");
  assert.deepEqual(
    changes.map((c) => [c.type, c.text]),
    [
      ["same", "Show "],
      ["removed", "an "],
      ["added", "a friendly "],
      ["same", "error message"],
    ],
  );
});

test("suggested messages name the steps that changed", () => {
  const before = flow([step("a", { title: "Home" }), step("b", { title: "Old checkout" })]);
  const after = flow([step("a", { title: "Home page" }), step("c", { title: "Sign-up screen" })]);
  assert.equal(suggestMessage(diffFlows(before, after)), "Add Sign-up screen, change Home page, remove Old checkout");
});

test("a word at the end still matches when text is added after it", () => {
  const changes = diffWords("User opens the app", "User opens the app for the first time");
  assert.deepEqual(
    changes.map((c) => [c.type, c.text]),
    [
      ["same", "User opens the app "],
      ["added", "for the first time"],
    ],
  );
});

test("the first version gets a simple message", () => {
  assert.equal(suggestMessage(diffFlows(null, flow([step("a"), step("b")])), "Habit tracker"), "First version of Habit tracker");
});

test("suggested messages list steps from top to bottom", () => {
  const before = flow([step("a")]);
  const after = flow([
    step("a"),
    step("z", { title: "Lower", position: { x: 0, y: 400 } }),
    step("b", { title: "Upper", position: { x: 0, y: 200 } }),
  ]);
  assert.equal(suggestMessage(diffFlows(before, after)), "Add Upper and Lower");
});

test("adding a tag is a change to the step", () => {
  const d = diffFlows(flow([step("a")]), flow([step("a", { tags: ["auth"] })]));
  assert.deepEqual(d.nodes[0].status === "changed" && d.nodes[0].fields, ["tags"]);
});

test("grouping steps and renaming groups count as design changes", () => {
  const base = parseFlow({
    schema: 1,
    name: "App",
    nodes: [
      { id: "a", kind: "start", title: "Open", position: { x: 0, y: 0 } },
      { id: "b", kind: "step", title: "Pay", position: { x: 0, y: 200 } },
    ],
    edges: [],
  });
  // Flows without groups are saved exactly as before groups existed.
  assert.ok(!serializeFlow(base).includes("groups"));

  const grouped = parseFlow({
    ...base,
    groups: [{ id: "g", title: "Checkout" }, { id: "empty", title: "Nothing in here" }],
    nodes: base.nodes.map((n) => (n.id === "b" ? { ...n, group: "g" } : n)),
  });
  assert.deepEqual(grouped.groups.map((g) => g.id), ["g"], "empty groups are dropped");
  const diff = diffFlows(base, grouped);
  assert.deepEqual(diff.meta.groups, { before: [], after: ["Checkout: Pay"] });
  assert.equal(diff.stats.detailsChanged, 1);
  assert.equal(diff.stats.stepsChanged, 0);

  const renamed = { ...grouped, groups: [{ id: "g", title: "Paying" }] };
  assert.deepEqual(diffFlows(grouped, renamed).meta.groups?.after, ["Paying: Pay"]);
});

test("developer details show up in version diffs, and are left out of files when empty", () => {
  const base = parseFlow({
    schema: 1,
    name: "Store",
    nodes: [{ id: "pay", kind: "api", title: "Charge", position: { x: 0, y: 0 } }],
    edges: [],
  });
  assert.ok(!/codeRef|uses|rules|stack/.test(serializeFlow(base)), "nothing new is written for flows without them");

  const after = {
    ...base,
    stack: ["Next.js", "Stripe"],
    nodes: base.nodes.map((n) => ({ ...n, codeRef: "POST /api/checkout", uses: ["Stripe"], rules: ["Never store card numbers"] })),
  };
  const diff = diffFlows(base, after);
  const change = diff.nodes[0];
  assert.equal(change.status, "changed");
  assert.deepEqual(change.status === "changed" && change.fields, ["codeRef", "uses", "rules"]);
  assert.deepEqual(diff.meta.stack, { before: [], after: ["Next.js", "Stripe"] });
  assert.match(serializeFlow(after), /"codeRef": "POST \/api\/checkout"/);
});
