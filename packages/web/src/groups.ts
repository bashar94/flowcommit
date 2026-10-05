import type { Node } from "@xyflow/react";
import { LAYOUT, layoutBlocks, layoutFlow, type FlowGroup, type NodeKind } from "@flowcommit/shared";
import type { ArrowEdge, StepNode } from "./model.ts";

/**
 * Groups are named parts of a flow. Open, a group is a frame drawn around its steps. Folded, its
 * steps are replaced by one card, and arrows into or out of the group connect to that card.
 */

export type GroupCardData = {
  groupId: string;
  title: string;
  count: number;
  kinds: NodeKind[];
  /** Reading numbers of the first and last step inside, like 4 and 9. */
  range: [number, number] | null;
};
export type GroupCardNode = Node<GroupCardData, "folded">;
export type CanvasNode = StepNode | GroupCardNode;

export const groupCardId = (groupId: string) => `group:${groupId}`;
export const isGroupCard = (id: string) => id.startsWith("group:");

export type Bounds = { x: number; y: number; width: number; height: number };

/** The room a group's frame takes around its steps: padding, plus its title bar on top. */
export const FRAME = { pad: 22, header: 34 } as const;

/** A folded group's card, before it has been measured. */
const CARD = { width: LAYOUT.cardWidth, height: 132 };

/** The box around a group's steps, using each card's measured size. */
export function groupBounds(members: StepNode[]): Bounds | null {
  if (!members.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of members) {
    const w = n.measured?.width ?? LAYOUT.cardWidth;
    const h = n.measured?.height ?? LAYOUT.cardHeight;
    minX = Math.min(minX, n.position.x);
    minY = Math.min(minY, n.position.y);
    maxX = Math.max(maxX, n.position.x + w);
    maxY = Math.max(maxY, n.position.y + h);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * What the canvas shows once folded groups are applied: their steps are hidden, a card stands in
 * for each, and arrows are redirected to the cards. Arrows between steps of the same folded group
 * are hidden, and two arrows that now join the same cards are drawn once.
 */
export function foldGroups(
  nodes: StepNode[],
  edges: ArrowEdge[],
  groups: FlowGroup[],
  folded: Set<string>,
  numbers: Map<string, number>,
): { nodes: CanvasNode[]; edges: ArrowEdge[] } {
  const active = groups.filter((g) => folded.has(g.id) && nodes.some((n) => n.data.group === g.id));
  if (!active.length) return { nodes, edges };

  const foldedIds = new Set(active.map((g) => g.id));
  const standIn = new Map<string, string>(); // step id -> group card id
  for (const n of nodes) if (n.data.group && foldedIds.has(n.data.group)) standIn.set(n.id, groupCardId(n.data.group));

  const cards: GroupCardNode[] = active.map((g) => {
    const members = nodes.filter((n) => n.data.group === g.id);
    const box = groupBounds(members)!;
    const nums = members.map((n) => numbers.get(n.id)).filter((x): x is number => x !== undefined);
    return {
      id: groupCardId(g.id),
      type: "folded",
      // Centered where its steps were, so the arrows around it barely move.
      position: { x: box.x + box.width / 2 - LAYOUT.cardWidth / 2, y: box.y },
      draggable: false,
      selectable: false,
      data: {
        groupId: g.id,
        title: g.title,
        count: members.length,
        kinds: [...new Set(members.map((n) => n.data.kind))],
        range: nums.length ? [Math.min(...nums), Math.max(...nums)] : null,
      },
    };
  });

  const seen = new Set<string>();
  const shownEdges: ArrowEdge[] = [];
  for (const e of edges) {
    const source = standIn.get(e.source) ?? e.source;
    const target = standIn.get(e.target) ?? e.target;
    if (source === target) continue;
    const key = `${source}->${target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const rerouted = source !== e.source || target !== e.target;
    // An arrow to or from a folded group drops its label: it names a choice inside the group,
    // which is noise in the overview (open the group to see it).
    shownEdges.push(
      rerouted
        ? {
            ...e,
            source,
            target,
            sourceHandle: source !== e.source ? null : e.sourceHandle,
            label: undefined,
            data: e.data ? { ...e.data, label: "" } : e.data,
          }
        : e,
    );
  }

  return {
    nodes: [...nodes.map((n) => (standIn.has(n.id) ? { ...n, hidden: true } : n)), ...cards],
    edges: shownEdges,
  };
}

/** Stable, short ids like g-1a2b3c4d. */
export function newGroupId(): string {
  return `g-${crypto.randomUUID().slice(0, 8)}`;
}

// ----- Laying out by parts -----
//
// In a flow with groups, each group is a block: its steps are laid out inside it, and the blocks
// (and any steps outside groups) are laid out like steps are. So a group's frame never takes in
// other steps, and opening a folded group makes room for it instead of covering its neighbours.

type Unit = { id: string; members: StepNode[]; group?: string };

function unitsOf(nodes: StepNode[], groups: FlowGroup[]): { units: Unit[]; unitOf: Map<string, string> } {
  const groupIds = new Set(groups.map((g) => g.id));
  const units: Unit[] = [];
  const unitOf = new Map<string, string>();
  const byGroup = new Map<string, StepNode[]>();
  for (const n of nodes) {
    const g = n.data.group;
    if (g && groupIds.has(g)) byGroup.set(g, [...(byGroup.get(g) ?? []), n]);
    else units.push({ id: n.id, members: [n] });
  }
  for (const [g, members] of byGroup) units.push({ id: groupCardId(g), members, group: g });
  for (const u of units) for (const m of u.members) unitOf.set(m.id, u.id);
  return { units, unitOf };
}

function unitEdges(edges: ArrowEdge[], unitOf: Map<string, string>) {
  const seen = new Set<string>();
  const out: { source: string; target: string }[] = [];
  for (const e of edges) {
    const source = unitOf.get(e.source);
    const target = unitOf.get(e.target);
    if (!source || !target || source === target || seen.has(`${source}>${target}`)) continue;
    seen.add(`${source}>${target}`);
    out.push({ source, target });
  }
  return out;
}

const startsOf = (units: Unit[]) => units.filter((u) => u.members.some((m) => m.data.kind === "start")).map((u) => u.id);

/** Where a block's top-left corner is now: the frame of an open group, or the card. */
function blockBox(u: Unit, folded: boolean, cardSize: { width: number; height: number }): Bounds {
  const box = groupBounds(u.members)!;
  if (!u.group) return box;
  if (folded) return { x: box.x + box.width / 2 - cardSize.width / 2, y: box.y, ...cardSize };
  return { x: box.x - FRAME.pad, y: box.y - FRAME.pad - FRAME.header, width: box.width + FRAME.pad * 2, height: box.height + FRAME.pad * 2 + FRAME.header };
}

/**
 * Tidies up a flow with groups: lays each group's steps out inside it, then lays the groups and
 * loose steps out as blocks. Returns the steps with their new positions.
 */
export function arrangeByParts(nodes: StepNode[], edges: ArrowEdge[], groups: FlowGroup[]): StepNode[] {
  const { units, unitOf } = unitsOf(nodes, groups);
  const placedInside = new Map<string, { x: number; y: number }>();
  for (const u of units) {
    if (!u.group) continue;
    const ids = u.members.map((m) => m.id);
    const inner = edges.filter((e) => unitOf.get(e.source) === u.id && unitOf.get(e.target) === u.id);
    // A part starts where people reach it from the rest of the app, then at steps nothing leads to.
    const entered = new Set(edges.filter((e) => unitOf.get(e.target) === u.id && unitOf.get(e.source) !== u.id).map((e) => e.target));
    const hasIncoming = new Set(inner.map((e) => e.target));
    const roots = [...ids.filter((id) => entered.has(id)), ...ids.filter((id) => !hasIncoming.has(id) && !entered.has(id))];
    const heights = new Map(u.members.map((m) => [m.id, m.measured?.height ?? LAYOUT.cardHeight]));
    const pos = layoutFlow(ids, inner, roots, heights);
    for (const m of u.members) {
      const p = pos.get(m.id)!;
      const mid = p.x + LAYOUT.cardWidth / 2;
      placedInside.set(m.id, { x: mid - (m.measured?.width ?? LAYOUT.cardWidth) / 2, y: p.y });
    }
  }
  // Each group's size once its steps are laid out inside it.
  const inside = (u: Unit) => u.members.map((m) => ({ ...m, position: placedInside.get(m.id) ?? m.position }));
  const sizes = new Map(units.map((u) => [u.id, blockBox({ ...u, members: inside(u) }, false, CARD)]));
  const origins = layoutBlocks(
    units.map((u) => u.id),
    unitEdges(edges, unitOf),
    startsOf(units),
    new Map([...sizes].map(([id, b]) => [id, { width: b.width, height: b.height }])),
  );
  const moved = new Map<string, { x: number; y: number }>();
  for (const u of units) {
    const members = inside(u);
    const from = blockBox({ ...u, members }, false, CARD);
    const to = origins.get(u.id)!;
    for (const m of members) moved.set(m.id, { x: Math.round(m.position.x + to.x - from.x), y: Math.round(m.position.y + to.y - from.y) });
  }
  return nodes.map((n) => (moved.has(n.id) ? { ...n, position: moved.get(n.id)! } : n));
}

/**
 * While some groups are folded, the canvas shows a compact layout: folded groups take a card's
 * room and open ones their frame's, so opening a group pushes the others aside. These are only
 * offsets for drawing; the flow's own positions stay as they are.
 */
export function foldedOffsets(
  nodes: StepNode[],
  edges: ArrowEdge[],
  groups: FlowGroup[],
  folded: Set<string>,
  cardSizes: Map<string, { width: number; height: number }>,
): Map<string, { x: number; y: number }> {
  const offsets = new Map<string, { x: number; y: number }>();
  if (!groups.some((g) => folded.has(g.id))) return offsets;
  const { units, unitOf } = unitsOf(nodes, groups);
  const boxes = new Map(
    units.map((u) => [u.id, blockBox(u, !!u.group && folded.has(u.group), cardSizes.get(u.id) ?? CARD)]),
  );
  const origins = layoutBlocks(
    units.map((u) => u.id),
    unitEdges(edges, unitOf),
    startsOf(units),
    new Map([...boxes].map(([id, b]) => [id, { width: b.width, height: b.height }])),
  );
  for (const u of units) {
    const from = boxes.get(u.id)!;
    const to = origins.get(u.id)!;
    for (const m of u.members) offsets.set(m.id, { x: to.x - from.x, y: to.y - from.y });
  }
  return offsets;
}
