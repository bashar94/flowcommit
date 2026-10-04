/**
 * Helpers that make a flow easier to read: step numbers in reading order, which arrows loop
 * back, which steps connect to a given one, and the flow as an indented outline.
 */

type Node = { id: string; position: { x: number; y: number }; data: { kind: string; title: string } };
type Edge = { id: string; source: string; target: string; data?: { label: string } };

/** Cards whose tops are this close count as one row, so numbering doesn't zigzag. */
const ROW_TOLERANCE = 60;

/** Numbers steps top to bottom, then left to right, the order people read them in. */
export function readingNumbers(nodes: Node[]): Map<string, number> {
  const sorted = [...nodes].sort((a, b) => a.position.y - b.position.y);
  const rows: Node[][] = [];
  for (const n of sorted) {
    const row = rows[rows.length - 1];
    if (row && n.position.y - row[0].position.y < ROW_TOLERANCE) row.push(n);
    else rows.push([n]);
  }
  const numbers = new Map<string, number>();
  let i = 1;
  for (const row of rows) for (const n of row.sort((a, b) => a.position.x - b.position.x)) numbers.set(n.id, i++);
  return numbers;
}

/** An arrow that goes back up the flow, like "Try again". */
export function isBackEdge(edge: Edge, byId: Map<string, Node>): boolean {
  const s = byId.get(edge.source);
  const t = byId.get(edge.target);
  return !!s && !!t && t.position.y < s.position.y - 10;
}

/** What leads to a step and what follows from it, without following loops back up. */
export function related(id: string, nodes: Node[], edges: Edge[]): { nodes: Set<string>; edges: Set<string> } {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const forward = edges.filter((e) => !isBackEdge(e, byId));
  const seenNodes = new Set([id]);
  const seenEdges = new Set<string>();
  const walk = (from: string, dir: "down" | "up") => {
    for (const e of forward) {
      const [here, there] = dir === "down" ? [e.source, e.target] : [e.target, e.source];
      if (here !== from) continue;
      seenEdges.add(e.id);
      if (!seenNodes.has(there)) {
        seenNodes.add(there);
        walk(there, dir);
      }
    }
  };
  walk(id, "down");
  walk(id, "up");
  // Loops that start and end inside the highlighted path belong to it too.
  for (const e of edges) if (seenNodes.has(e.source) && seenNodes.has(e.target)) seenEdges.add(e.id);
  return { nodes: seenNodes, edges: seenEdges };
}

export type OutlineItem =
  | { type: "step"; id: string; depth: number; via: string }
  /** The flow goes to a step that's already listed: back up for a loop, or ahead where branches meet. */
  | { type: "goto"; id: string; depth: number; via: string; back: boolean };

/** The flow as an indented list: one line per step, with each branch of a decision indented under it. */
export function outline(nodes: Node[], edges: Edge[], numbers: Map<string, number>): OutlineItem[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const items: OutlineItem[] = [];
  const listed = new Set<string>();
  const order = (id: string) => numbers.get(id) ?? 0;

  const visit = (id: string, depth: number, via: string) => {
    listed.add(id);
    items.push({ type: "step", id, depth, via });
    const out = edges
      .filter((e) => e.source === id)
      .sort((a, b) => (byId.get(a.target)?.position.x ?? 0) - (byId.get(b.target)?.position.x ?? 0));
    const branching = out.length > 1;
    for (const e of out) {
      const label = e.data?.label ?? "";
      const childDepth = branching ? depth + 1 : depth;
      if (listed.has(e.target)) {
        items.push({ type: "goto", id: e.target, depth: childDepth, via: label, back: order(e.target) < order(id) });
      } else {
        visit(e.target, childDepth, label);
      }
    }
  };

  const hasIncoming = new Set(edges.map((e) => e.target));
  const starts = nodes
    .filter((n) => n.data.kind === "start" || !hasIncoming.has(n.id))
    .sort((a, b) => order(a.id) - order(b.id));
  for (const n of starts) if (!listed.has(n.id)) visit(n.id, 0, "");
  // Anything not reachable from a start is still listed, so nothing is hidden.
  for (const n of [...nodes].sort((a, b) => order(a.id) - order(b.id))) if (!listed.has(n.id)) visit(n.id, 0, "");
  return items;
}

/** Arrow color for a branch label, so Yes and No are told apart at a glance. */
export function arrowTone(label: string): "yes" | "no" | "plain" {
  const l = label.trim().toLowerCase();
  if (/^(yes|y|ok|okay|success|succeeded|valid|true|approved|paid|found|logged in|signed in)\b/.test(l)) return "yes";
  if (/^(no|n|fail|failed|failure|error|invalid|false|denied|declined|cancel|cancelled|not found|timeout)\b/.test(l)) return "no";
  return "plain";
}

type Box = { position: { x: number }; measured?: { width?: number } };

/** How far a step must sit to one side of a decision before the arrow leaves from that corner. */
export const SIDE_THRESHOLD = 60;

/**
 * Which corner of a decision diamond an arrow should leave from, based on where its target is:
 * the left or right corner when the target is off to that side, the bottom when it's below.
 * Arrows that loop back up go around the right side.
 */
export function decisionSide(source: Box, target: Box, back: boolean): "left" | "right" | undefined {
  if (back) return "right";
  const center = (b: Box, fallback: number) => b.position.x + (b.measured?.width ?? fallback) / 2;
  const dx = center(target, 248) - center(source, 260);
  if (dx < -SIDE_THRESHOLD) return "left";
  if (dx > SIDE_THRESHOLD) return "right";
  return undefined;
}
