import type { FlowDiff, FlowNode } from "@flowcommit/shared";
import { DEFAULT_EDGE_OPTIONS, type ArrowEdge, type DiffMark, type StepNode } from "./model.ts";

/** One side of a comparison: a commit, the unsaved draft, or nothing (before the first version). */
export type Side = { kind: "version"; sha: string; label: string } | { kind: "draft" } | { kind: "empty" };

export const sideKey = (s: Side) => (s.kind === "version" ? s.sha : s.kind);

export const sideLabel = (s: Side) =>
  s.kind === "version" ? s.label : s.kind === "draft" ? "Unsaved changes" : "Empty canvas";

export const shortSha = (sha: string) => sha.slice(0, 7);

/** How a commit is named in menus: its message, shortened, and its short id. */
export const commitLabel = (c: { sha: string; message: string }) =>
  `${c.message.length > 48 ? `${c.message.slice(0, 47)}…` : c.message} (${shortSha(c.sha)})`;

const EDGE_COLOR = {
  added: "var(--add)",
  removed: "var(--del)",
  changed: "var(--chg)",
  unchanged: "var(--ink-soft)",
} as const;

const assetVersionOf = (s: Side) => (s.kind === "version" ? s.sha : undefined);

const toStep = (n: FlowNode, diff: DiffMark | undefined, assetVersion: string | undefined): StepNode => ({
  id: n.id,
  type: "step",
  position: n.position,
  draggable: false,
  connectable: false,
  data: {
    kind: n.kind,
    title: n.title,
    instructions: n.instructions,
    attachments: n.attachments,
    tags: n.tags,
    diff,
    assetVersion,
  },
});

/**
 * Lays both versions over each other on one canvas. Steps and arrows that exist in either version
 * are shown, marked with how they changed. Removed steps stay where they used to be.
 */
export function diffCanvas(diff: FlowDiff, base: Side, target: Side): { nodes: StepNode[]; edges: ArrowEdge[] } {
  const beforeAssets = assetVersionOf(base);
  const afterAssets = assetVersionOf(target);

  const nodes = diff.nodes.map((n) => {
    switch (n.status) {
      case "added":
        return toStep(n.after, "added", afterAssets);
      case "removed":
        return toStep(n.before, "removed", beforeAssets);
      case "changed":
        return toStep(n.after, "changed", afterAssets);
      case "unchanged":
        return toStep(n.after, n.moved ? "moved" : undefined, afterAssets);
    }
  });

  const edges: ArrowEdge[] = diff.edges.map((e) => {
    const edge = e.status === "removed" ? e.before : e.after;
    const label = edge.label;
    return {
      ...DEFAULT_EDGE_OPTIONS,
      markerEnd: { ...DEFAULT_EDGE_OPTIONS.markerEnd, color: EDGE_COLOR[e.status] },
      id: e.key,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
      label: label || undefined,
      data: { label },
      className: `diff-${e.status}`,
      selectable: false,
      focusable: false,
    };
  });

  return { nodes, edges };
}
