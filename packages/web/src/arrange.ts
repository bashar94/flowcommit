import { LAYOUT, layoutFlow } from "@flowcommit/shared";
import type { ArrowEdge, StepNode } from "./model.ts";

/**
 * Lays the flow out top to bottom using each card's measured size and centers every card on its
 * column. (Which corner a decision's arrows leave from is worked out when they're drawn.)
 */
export function arrange(nodes: StepNode[], edges: ArrowEdge[]): { nodes: StepNode[]; edges: ArrowEdge[] } {
  const starts = nodes.filter((n) => n.data.kind === "start").map((n) => n.id);
  const heights = new Map(nodes.map((n) => [n.id, n.measured?.height ?? LAYOUT.cardHeight]));
  const positions = layoutFlow(
    nodes.map((n) => n.id),
    edges,
    starts,
    heights,
    new Map(nodes.filter((n) => n.data.group).map((n) => [n.id, n.data.group!])),
  );

  const placed = nodes.map((n) => {
    const p = positions.get(n.id) ?? n.position;
    const mid = p.x + LAYOUT.cardWidth / 2;
    return { ...n, position: { x: Math.round(mid - (n.measured?.width ?? LAYOUT.cardWidth) / 2), y: p.y } };
  });

  return {
    nodes: placed,
    edges,
  };
}
