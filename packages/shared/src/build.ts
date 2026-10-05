import { z } from "zod";
import { AttachmentSchema, NODE_KINDS, serializeAttachment, type FlowFile, type FlowNode } from "./flow.ts";
import { layoutFlow } from "./layout.ts";

/**
 * Build status records what an AI agent has built for each step. It lives in
 * `.flowcommit/status.json`, next to the flow but outside version history, because it
 * describes the code on this computer rather than the design.
 */

export const STATUS_FILE = "status.json";

export const BUILD_STATES = ["building", "built", "blocked"] as const;
export type BuildState = (typeof BUILD_STATES)[number];

export const StepSpecSchema = z.object({
  kind: z.enum(NODE_KINDS),
  title: z.string(),
  instructions: z.string(),
  attachments: z.array(AttachmentSchema),
  tags: z.array(z.string()).default([]),
  // Only present when set, so steps built before these existed still count as built.
  codeRef: z.string().optional(),
  uses: z.array(z.string()).optional(),
  rules: z.array(z.string()).optional(),
});
export type StepSpec = z.infer<typeof StepSpecSchema>;

export const StepBuildSchema = z.object({
  state: z.enum(BUILD_STATES),
  /** What the agent built, or for a blocked step, what it needs from the user. */
  note: z.string().default(""),
  files: z.array(z.string()).default([]),
  /** Git hashes of those files when the step was built, to notice code edited outside a build. */
  fileHashes: z.record(z.string(), z.string()).default({}),
  agent: z.string().default(""),
  updatedAt: z.string(),
  /** The step's design when it was last built, to spot later edits. */
  builtSpec: StepSpecSchema.nullable().default(null),
  /** What the builder reported creating, shown on the card until the person writes their own. */
  codeRef: z.string().optional(),
  uses: z.array(z.string()).optional(),
});
export type StepBuild = z.infer<typeof StepBuildSchema>;

export const BuildStatusSchema = z.object({
  schema: z.literal(1),
  steps: z.record(z.string(), StepBuildSchema),
});
export type BuildStatus = z.infer<typeof BuildStatusSchema>;

export const emptyBuildStatus = (): BuildStatus => ({ schema: 1, steps: {} });

/** What a step's card shows. "outdated" means it was built, then its design changed. */
export type BuildView = "todo" | "building" | "built" | "outdated" | "blocked";

/** What a step asks the builder for. Changing any of it means the step needs building again. */
export function specOf(
  n: Pick<FlowNode, "kind" | "title" | "instructions" | "attachments" | "tags" | "codeRef" | "uses" | "rules">,
): StepSpec {
  return {
    kind: n.kind,
    title: n.title,
    instructions: n.instructions,
    attachments: n.attachments.map(serializeAttachment),
    tags: n.tags,
    ...(n.codeRef ? { codeRef: n.codeRef } : {}),
    ...(n.uses?.length ? { uses: n.uses } : {}),
    ...(n.rules?.length ? { rules: n.rules } : {}),
  };
}

const sameSpec = (a: StepSpec, b: StepSpec) => JSON.stringify(a) === JSON.stringify(b);

export function buildView(node: FlowNode, record: StepBuild | undefined): BuildView {
  if (!record) return "todo";
  if (record.state !== "built") return record.state;
  return record.builtSpec && !sameSpec(record.builtSpec, specOf(node)) ? "outdated" : "built";
}

/** Start and End steps with nothing written on them are just markers; there's nothing to build. */
export function isBuildable(n: FlowNode): boolean {
  if (n.kind !== "start" && n.kind !== "end") return true;
  return n.instructions.trim().length > 0 || n.attachments.length > 0;
}

export type PlannedStep = {
  node: FlowNode;
  view: BuildView;
  /** Steps that lead into this one and aren't built yet. */
  waitingOn: FlowNode[];
};

/** Every buildable step in reading order (top to bottom), with what it's waiting on. */
export function buildPlan(flow: FlowFile, status: BuildStatus): PlannedStep[] {
  const starts = flow.nodes.filter((n) => n.kind === "start").map((n) => n.id);
  const pos = layoutFlow(
    flow.nodes.map((n) => n.id),
    flow.edges,
    starts,
  );
  const byId = new Map(flow.nodes.map((n) => [n.id, n]));
  const done = (n: FlowNode) => !isBuildable(n) || buildView(n, status.steps[n.id]) === "built";
  const order = (n: FlowNode) => pos.get(n.id) ?? n.position;

  return flow.nodes
    .filter(isBuildable)
    .sort((a, b) => order(a).y - order(b).y || order(a).x - order(b).x)
    .map((node) => ({
      node,
      view: buildView(node, status.steps[node.id]),
      waitingOn: flow.edges
        .filter((e) => e.target === node.id)
        .map((e) => byId.get(e.source)!)
        .filter((p) => p && !done(p) && order(p).y < order(node).y),
    }));
}

export function buildProgress(flow: FlowFile, status: BuildStatus) {
  const plan = buildPlan(flow, status);
  return {
    total: plan.length,
    built: plan.filter((p) => p.view === "built").length,
    building: plan.filter((p) => p.view === "building").length,
    blocked: plan.filter((p) => p.view === "blocked").length,
    outdated: plan.filter((p) => p.view === "outdated").length,
  };
}
