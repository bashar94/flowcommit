import { serializeAttachment, type Attachment, type FlowEdge, type FlowFile, type FlowNode } from "./flow.ts";

/** Design fields of a step. Position is tracked separately because moving a card isn't a design change. */
export const NODE_FIELDS = ["kind", "title", "instructions", "attachments", "tags"] as const;
export type NodeField = (typeof NODE_FIELDS)[number];

export type NodeDiff =
  | { status: "added"; id: string; after: FlowNode }
  | { status: "removed"; id: string; before: FlowNode }
  | { status: "changed"; id: string; before: FlowNode; after: FlowNode; fields: NodeField[]; moved: boolean }
  | { status: "unchanged"; id: string; before: FlowNode; after: FlowNode; moved: boolean };

export type EdgeDiff =
  | { status: "added"; key: string; after: FlowEdge }
  | { status: "removed"; key: string; before: FlowEdge }
  | { status: "changed"; key: string; before: FlowEdge; after: FlowEdge }
  | { status: "unchanged"; key: string; before: FlowEdge; after: FlowEdge };

export type DiffStats = {
  stepsAdded: number;
  stepsRemoved: number;
  stepsChanged: number;
  stepsMoved: number;
  arrowsAdded: number;
  arrowsRemoved: number;
  arrowsChanged: number;
  detailsChanged: number;
};

export type FlowDiff = {
  meta: {
    name?: { before: string; after: string };
    description?: { before: string; after: string };
    /** Each group as "Title: step, step", so renaming a group or moving steps between groups shows up. */
    groups?: { before: string[]; after: string[] };
  };
  nodes: NodeDiff[];
  edges: EdgeDiff[];
  stats: DiffStats;
};

/** Arrows are matched by the steps they connect, so redrawing the same arrow isn't reported as a change. */
export function edgeKey(e: Pick<FlowEdge, "source" | "target">): string {
  return `${e.source}->${e.target}`;
}

const sameAttachments = (a: Attachment[], b: Attachment[]) =>
  a.length === b.length &&
  a.every((x, i) => JSON.stringify(serializeAttachment(x)) === JSON.stringify(serializeAttachment(b[i])));

const samePosition = (a: FlowNode, b: FlowNode) =>
  Math.round(a.position.x) === Math.round(b.position.x) && Math.round(a.position.y) === Math.round(b.position.y);

/** Compares two versions of a flow. Pass `null` as `before` for the very first version. */
export function diffFlows(before: FlowFile | null, after: FlowFile): FlowDiff {
  const oldNodes = new Map((before?.nodes ?? []).map((n) => [n.id, n]));
  const newNodes = new Map(after.nodes.map((n) => [n.id, n]));
  const nodes: NodeDiff[] = [];

  for (const [id, a] of newNodes) {
    const b = oldNodes.get(id);
    if (!b) {
      nodes.push({ status: "added", id, after: a });
      continue;
    }
    const fields = NODE_FIELDS.filter((f) =>
      f === "attachments"
        ? !sameAttachments(b.attachments, a.attachments)
        : f === "tags"
          ? b.tags.join("\n") !== a.tags.join("\n")
          : b[f] !== a[f],
    );
    const moved = !samePosition(b, a);
    nodes.push(
      fields.length > 0
        ? { status: "changed", id, before: b, after: a, fields, moved }
        : { status: "unchanged", id, before: b, after: a, moved },
    );
  }
  for (const [id, b] of oldNodes) {
    if (!newNodes.has(id)) nodes.push({ status: "removed", id, before: b });
  }

  const oldEdges = new Map((before?.edges ?? []).map((e) => [edgeKey(e), e]));
  const newEdges = new Map(after.edges.map((e) => [edgeKey(e), e]));
  const edges: EdgeDiff[] = [];
  for (const [key, a] of newEdges) {
    const b = oldEdges.get(key);
    if (!b) edges.push({ status: "added", key, after: a });
    else if (b.label !== a.label) edges.push({ status: "changed", key, before: b, after: a });
    else edges.push({ status: "unchanged", key, before: b, after: a });
  }
  for (const [key, b] of oldEdges) {
    if (!newEdges.has(key)) edges.push({ status: "removed", key, before: b });
  }

  const meta: FlowDiff["meta"] = {};
  if (before && before.name !== after.name) meta.name = { before: before.name, after: after.name };
  if ((before?.description ?? "") !== after.description) {
    meta.description = { before: before?.description ?? "", after: after.description };
  }

  const before_ = groupSummary(before);
  const after_ = groupSummary(after);
  if (before_.join("\n") !== after_.join("\n")) meta.groups = { before: before_, after: after_ };

  const count = <T extends { status: string }>(list: T[], status: string) =>
    list.filter((x) => x.status === status).length;
  const stats: DiffStats = {
    stepsAdded: count(nodes, "added"),
    stepsRemoved: count(nodes, "removed"),
    stepsChanged: count(nodes, "changed"),
    stepsMoved: nodes.filter((n) => (n.status === "changed" || n.status === "unchanged") && n.moved).length,
    arrowsAdded: count(edges, "added"),
    arrowsRemoved: count(edges, "removed"),
    arrowsChanged: count(edges, "changed"),
    detailsChanged: Object.keys(meta).length,
  };

  return { meta, nodes, edges, stats };
}

function groupSummary(flow: FlowFile | null): string[] {
  if (!flow) return [];
  return [...(flow.groups ?? [])]
    .map((g) => {
      const steps = flow.nodes.filter((n) => n.group === g.id).map((n) => n.title || "Untitled step").sort();
      return `${g.title || "Untitled group"}: ${steps.join(", ")}`;
    })
    .sort();
}

/** True when the diff has design changes. Moving cards around alone doesn't count. */
export function hasDesignChanges(stats: DiffStats): boolean {
  return (
    stats.stepsAdded + stats.stepsRemoved + stats.stepsChanged +
      stats.arrowsAdded + stats.arrowsRemoved + stats.arrowsChanged + stats.detailsChanged > 0
  );
}

/** A short sentence like "2 steps added, 1 step changed, 1 arrow removed". */
export function summarizeDiff(stats: DiffStats): string {
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const parts: string[] = [];
  if (stats.stepsAdded) parts.push(`${plural(stats.stepsAdded, "step")} added`);
  if (stats.stepsRemoved) parts.push(`${plural(stats.stepsRemoved, "step")} removed`);
  if (stats.stepsChanged) parts.push(`${plural(stats.stepsChanged, "step")} changed`);
  if (stats.arrowsAdded) parts.push(`${plural(stats.arrowsAdded, "arrow")} added`);
  if (stats.arrowsRemoved) parts.push(`${plural(stats.arrowsRemoved, "arrow")} removed`);
  if (stats.arrowsChanged) parts.push(`${plural(stats.arrowsChanged, "arrow label")} changed`);
  if (stats.detailsChanged) parts.push("flow details changed");
  if (parts.length === 0 && stats.stepsMoved) parts.push(`${plural(stats.stepsMoved, "step")} moved`);
  return parts.length ? parts.join(", ") : "No changes";
}

export type WordChange = { type: "same" | "added" | "removed"; text: string };

const MAX_LCS_CELLS = 250_000;

/** Word-level diff of two texts, used to highlight what changed in a step's instructions. */
export function diffWords(before: string, after: string): WordChange[] {
  if (before === after) return before ? [{ type: "same", text: before }] : [];
  // Each token is a word plus the spaces after it, so changes don't get split around whitespace.
  const tokenize = (text: string) => text.match(/\S+\s*|\s+/g) ?? [];
  const a = tokenize(before);
  const b = tokenize(after);
  // Words are compared without their trailing spaces, so "app" at the end still matches "app ".
  const ka = a.map((t) => t.trimEnd());
  const kb = b.map((t) => t.trimEnd());
  if (a.length * b.length > MAX_LCS_CELLS) {
    return [
      { type: "removed", text: before },
      { type: "added", text: after },
    ].filter((c) => c.text) as WordChange[];
  }

  // Longest common subsequence table, filled from the end so we can walk it forwards.
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = ka[i] === kb[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const out: WordChange[] = [];
  const push = (type: WordChange["type"], text: string) => {
    const last = out[out.length - 1];
    if (last?.type === type) last.text += text;
    else out.push({ type, text });
  };
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (ka[i] === kb[j]) {
      push("same", b[j]);
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      push("removed", a[i++]);
    } else {
      push("added", b[j++]);
    }
  }
  while (i < a.length) push("removed", a[i++]);
  while (j < b.length) push("added", b[j++]);
  return out;
}

/** Orders steps the way people read a flow: top to bottom, then left to right. */
export function sortByPosition<T extends NodeDiff>(nodes: T[]): T[] {
  const pos = (n: NodeDiff) => (n.status === "removed" ? n.before.position : n.after.position);
  return [...nodes].sort((a, b) => pos(a).y - pos(b).y || pos(a).x - pos(b).x);
}

/** A version message written from the changes, e.g. "Add Sign-up screen, change Checkout". */
export function suggestMessage(diff: FlowDiff, flowName = ""): string {
  const s = diff.stats;
  const everythingNew = diff.nodes.length > 0 && diff.nodes.every((n) => n.status === "added");
  if (everythingNew) return flowName ? `First version of ${flowName}` : "First version";

  const names = (status: NodeDiff["status"]) =>
    sortByPosition(diff.nodes.filter((n) => n.status === status)).map(
      (n) => (n.status === "removed" ? n.before.title : (n as { after: FlowNode }).after.title) || "untitled step",
    );
  const list = (items: string[]) =>
    items.length <= 2 ? items.join(" and ") : `${items.slice(0, 2).join(", ")} and ${items.length - 2} more`;

  const parts: string[] = [];
  const added = names("added");
  const changed = names("changed");
  const removed = names("removed");
  if (added.length) parts.push(`add ${list(added)}`);
  if (changed.length) parts.push(`change ${list(changed)}`);
  if (removed.length) parts.push(`remove ${list(removed)}`);
  if (parts.length === 0) {
    if (s.arrowsAdded + s.arrowsRemoved + s.arrowsChanged) parts.push("update arrows");
    else if (s.detailsChanged) parts.push("update flow details");
    else if (s.stepsMoved) parts.push("rearrange steps");
    else return "Update flow";
  }
  const text = parts.join(", ");
  return text[0].toUpperCase() + text.slice(1);
}
