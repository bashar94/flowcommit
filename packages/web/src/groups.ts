import type { Node } from "@xyflow/react";
import { LAYOUT, type FlowGroup, type NodeKind } from "@flowcommit/shared";
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
    shownEdges.push(rerouted ? { ...e, source, target, sourceHandle: source !== e.source ? null : e.sourceHandle } : e);
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
