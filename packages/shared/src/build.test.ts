import { test } from "node:test";
import assert from "node:assert/strict";
import { createEmptyFlow, type FlowFile, type FlowNode } from "./flow.ts";
import { buildPlan, buildProgress, buildView, emptyBuildStatus, specOf, type BuildStatus } from "./build.ts";

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

const flow: FlowFile = {
  ...createEmptyFlow("t"),
  nodes: [step("start", { kind: "start" }), step("form", { kind: "screen" }), step("save", { kind: "api" }), step("end", { kind: "end" })],
  edges: [
    { id: "1", source: "start", target: "form", label: "" },
    { id: "2", source: "form", target: "save", label: "" },
    { id: "3", source: "save", target: "end", label: "" },
  ],
};

const built = (node: FlowNode): BuildStatus["steps"][string] => ({
  state: "built",
  note: "",
  files: [],
  fileHashes: {},
  agent: "",
  updatedAt: "2026-10-04T00:00:00Z",
  builtSpec: specOf(node),
});

test("empty Start and End steps aren't part of the build", () => {
  const plan = buildPlan(flow, emptyBuildStatus());
  assert.deepEqual(plan.map((p) => p.node.id), ["form", "save"]);
});

test("a step waits for the unbuilt steps that lead into it", () => {
  const plan = buildPlan(flow, emptyBuildStatus());
  assert.deepEqual(plan[0].waitingOn, []);
  assert.deepEqual(plan[1].waitingOn.map((n) => n.id), ["form"]);
});

test("editing a step after it was built marks it outdated", () => {
  const form = flow.nodes[1];
  const status: BuildStatus = { schema: 1, steps: { form: built(form) } };
  assert.equal(buildView(form, status.steps.form), "built");
  assert.equal(buildView({ ...form, instructions: "Add a phone field" }, status.steps.form), "outdated");
  assert.equal(buildView({ ...form, position: { x: 400, y: 0 } }, status.steps.form), "built");
});

test("progress counts built steps", () => {
  const status: BuildStatus = { schema: 1, steps: { form: built(flow.nodes[1]) } };
  assert.deepEqual(buildProgress(flow, status), { total: 2, built: 1, building: 0, blocked: 0, outdated: 0 });
});
