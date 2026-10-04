import { z } from "zod";
import { NODE_KINDS, NODE_KIND_INFO, type FlowFile, type FlowNode } from "./flow.ts";
import { buildView, isBuildable, type BuildStatus } from "./build.ts";

/**
 * Keeping the design and the code in step, in both directions:
 * - Design → code: `pendingChanges` tells an AI agent what changed in the flow since it last
 *   built, including steps that were deleted (so their code gets removed too).
 * - Code → design: an agent can't edit the flow itself. It proposes changes as suggestions,
 *   which wait in `.flowcommit/suggestions.json` until the person accepts or dismisses them.
 */

export const SUGGESTIONS_FILE = "suggestions.json";

const StepDraftSchema = z.object({
  kind: z.enum(NODE_KINDS),
  title: z.string().min(1),
  instructions: z.string().default(""),
  tags: z.array(z.string()).default([]),
});

export const SuggestedChangeSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("add-step"),
    step: StepDraftSchema,
    /** The step it comes after, and the step it leads to, if any. */
    after: z.string().optional(),
    before: z.string().optional(),
    label: z.string().default(""),
  }),
  z.object({
    type: z.literal("edit-step"),
    stepId: z.string(),
    kind: z.enum(NODE_KINDS).optional(),
    title: z.string().optional(),
    /** Replaces the instructions entirely. Prefer `addInstructions`, which keeps the person's wording. */
    instructions: z.string().optional(),
    /** Added to the end of the existing instructions. */
    addInstructions: z.string().optional(),
  }),
  z.object({ type: z.literal("remove-step"), stepId: z.string() }),
  z.object({ type: z.literal("add-arrow"), from: z.string(), to: z.string(), label: z.string().default("") }),
  z.object({ type: z.literal("remove-arrow"), from: z.string(), to: z.string() }),
]);
export type SuggestedChange = z.infer<typeof SuggestedChangeSchema>;

export const SuggestionSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  /** Who suggested it, like "Claude Code". */
  source: z.string().default(""),
  /** Why, in plain words: what the code does that the flow doesn't show. */
  reason: z.string().default(""),
  /** Code files that show it. */
  files: z.array(z.string()).default([]),
  change: SuggestedChangeSchema,
});
export type Suggestion = z.infer<typeof SuggestionSchema>;

export const SuggestionsFileSchema = z.object({ schema: z.literal(1), suggestions: z.array(SuggestionSchema) });
export type SuggestionsFile = z.infer<typeof SuggestionsFileSchema>;
export const emptySuggestions = (): SuggestionsFile => ({ schema: 1, suggestions: [] });

const NEW_STEP_GAP = 180;

/**
 * Applies a suggestion to a flow and returns the new flow, or explains why it no longer fits
 * (for example, the step it refers to has since been deleted).
 */
export function applySuggestion(
  flow: FlowFile,
  s: Suggestion,
  newId: (prefix: string) => string,
): { flow: FlowFile } | { error: string } {
  const has = (id?: string) => !id || flow.nodes.some((n) => n.id === id);
  const c = s.change;
  switch (c.type) {
    case "add-step": {
      if (!has(c.after) || !has(c.before)) return { error: "A step this suggestion connects to no longer exists." };
      const anchor = flow.nodes.find((n) => n.id === c.after);
      const lowest = Math.max(0, ...flow.nodes.map((n) => n.position.y));
      const id = newId("n");
      const node: FlowNode = {
        id,
        kind: c.step.kind,
        title: c.step.title,
        instructions: c.step.instructions,
        tags: c.step.tags,
        attachments: [],
        position: anchor
          ? { x: anchor.position.x + 320, y: anchor.position.y + NEW_STEP_GAP / 2 }
          : { x: 0, y: lowest + NEW_STEP_GAP },
      };
      const edges = [...flow.edges];
      if (c.after) edges.push({ id: newId("e"), source: c.after, target: id, label: c.label });
      if (c.before) edges.push({ id: newId("e"), source: id, target: c.before, label: "" });
      return { flow: { ...flow, nodes: [...flow.nodes, node], edges } };
    }
    case "edit-step": {
      if (!has(c.stepId)) return { error: "The step this suggestion changes no longer exists." };
      return {
        flow: {
          ...flow,
          nodes: flow.nodes.map((n) =>
            n.id === c.stepId
              ? {
                  ...n,
                  kind: c.kind ?? n.kind,
                  title: c.title ?? n.title,
                  instructions: [c.instructions ?? n.instructions, c.addInstructions?.trim()].filter(Boolean).join("\n\n"),
                }
              : n,
          ),
        },
      };
    }
    case "remove-step":
      if (!has(c.stepId)) return { error: "That step has already been removed." };
      return {
        flow: {
          ...flow,
          nodes: flow.nodes.filter((n) => n.id !== c.stepId),
          edges: flow.edges.filter((e) => e.source !== c.stepId && e.target !== c.stepId),
        },
      };
    case "add-arrow":
      if (!has(c.from) || !has(c.to)) return { error: "A step this arrow connects no longer exists." };
      if (flow.edges.some((e) => e.source === c.from && e.target === c.to)) return { flow };
      return { flow: { ...flow, edges: [...flow.edges, { id: newId("e"), source: c.from, target: c.to, label: c.label }] } };
    case "remove-arrow":
      return { flow: { ...flow, edges: flow.edges.filter((e) => !(e.source === c.from && e.target === c.to)) } };
  }
}

/** One line describing a suggestion, using step titles rather than ids. */
export function describeSuggestion(s: Suggestion, flow: FlowFile): string {
  const title = (id?: string) => (id ? `"${flow.nodes.find((n) => n.id === id)?.title ?? "a removed step"}"` : "");
  const c = s.change;
  switch (c.type) {
    case "add-step":
      return `Add ${c.step.kind === "step" ? "a step" : `a ${NODE_KIND_INFO[c.step.kind].label.toLowerCase()} step`} "${c.step.title}"${c.after ? ` after ${title(c.after)}` : ""}${c.before ? `, leading to ${title(c.before)}` : ""}`;
    case "edit-step": {
      if (c.addInstructions && c.title === undefined && c.instructions === undefined && !c.kind) {
        return `Add to the instructions of ${title(c.stepId)}`;
      }
      const what = [c.title !== undefined && "title", (c.instructions !== undefined || c.addInstructions) && "instructions", c.kind && "type"].filter(Boolean);
      return `Update the ${what.join(" and ") || "details"} of ${title(c.stepId)}`;
    }
    case "remove-step":
      return `Remove ${title(c.stepId)}`;
    case "add-arrow":
      return `Connect ${title(c.from)} to ${title(c.to)}${c.label ? ` (${c.label})` : ""}`;
    case "remove-arrow":
      return `Disconnect ${title(c.from)} from ${title(c.to)}`;
  }
}

export type PendingChanges = {
  /** Built, then edited in the design. */
  changed: FlowNode[];
  /** In the design, never built. */
  added: FlowNode[];
  /** Built, then deleted from the design. Their code should go too. */
  removed: { id: string; title: string; files: string[] }[];
  /** Waiting for the person to answer a question. */
  blocked: FlowNode[];
};

/** Everything in the design an agent hasn't caught up with yet. */
export function pendingChanges(flow: FlowFile, status: BuildStatus): PendingChanges {
  const ids = new Set(flow.nodes.map((n) => n.id));
  const steps = flow.nodes.filter(isBuildable);
  const view = (n: FlowNode) => buildView(n, status.steps[n.id]);
  return {
    changed: steps.filter((n) => view(n) === "outdated"),
    added: steps.filter((n) => view(n) === "todo"),
    blocked: steps.filter((n) => view(n) === "blocked"),
    removed: Object.entries(status.steps)
      .filter(([id, r]) => !ids.has(id) && r.state === "built")
      .map(([id, r]) => ({ id, title: r.builtSpec?.title ?? "a removed step", files: r.files })),
  };
}

export function hasPending(p: PendingChanges): boolean {
  return p.changed.length + p.added.length + p.removed.length > 0;
}

/** A short summary for the start of an agent's turn, e.g. in a Claude Code hook. */
export function pendingSummary(p: PendingChanges): string {
  const names = (list: { title: string }[]) =>
    list
      .slice(0, 4)
      .map((n) => `"${n.title}"`)
      .join(", ") + (list.length > 4 ? ` and ${list.length - 4} more` : "");
  const parts: string[] = [];
  if (p.changed.length) parts.push(`${p.changed.length} changed (${names(p.changed)})`);
  if (p.added.length) parts.push(`${p.added.length} not built yet (${names(p.added)})`);
  if (p.removed.length) parts.push(`${p.removed.length} removed from the design (${names(p.removed)}), so their code should go`);
  return parts.length
    ? `FlowCommit: the app's design has steps that the code doesn't match yet: ${parts.join("; ")}. Use the flowcommit tools (get_design_changes, then next_step) to bring the code in line, or tell the person if now isn't the right time.`
    : "";
}
