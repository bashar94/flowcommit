import { newId, type ArrowEdge, type StepNode } from "./model.ts";

/**
 * Copying steps puts them on the system clipboard as JSON, so they can be pasted into another
 * FlowCommit window or project. Arrows come along when both their ends are copied.
 */

type Payload = { flowcommit: 1; nodes: Pick<StepNode, "id" | "position" | "data">[]; edges: ArrowEdge[] };

export function copyPayload(selected: StepNode[], edges: ArrowEdge[]): string {
  const ids = new Set(selected.map((n) => n.id));
  const payload: Payload = {
    flowcommit: 1,
    nodes: selected.map(({ id, position, data }) => ({ id, position, data: { ...data, diff: undefined, assetVersion: undefined } })),
    edges: edges.filter((e) => ids.has(e.source) && ids.has(e.target)).map(({ selected: _s, ...e }) => e),
  };
  return JSON.stringify(payload);
}

export function parsePayload(text: string): Payload | null {
  try {
    const p = JSON.parse(text);
    return p?.flowcommit === 1 && Array.isArray(p.nodes) && Array.isArray(p.edges) ? p : null;
  } catch {
    return null;
  }
}

/** Fresh copies with new ids, nudged so they don't sit exactly on top of the originals. */
export function instantiate(payload: Payload, offset: number): { nodes: StepNode[]; edges: ArrowEdge[] } {
  const ids = new Map(payload.nodes.map((n) => [n.id, newId("n")]));
  return {
    nodes: payload.nodes.map((n) => ({
      id: ids.get(n.id)!,
      type: "step",
      position: { x: n.position.x + offset, y: n.position.y + offset },
      selected: true,
      data: { ...n.data, tags: n.data.tags ?? [], attachments: (n.data.attachments ?? []).map((a) => ({ ...a, id: newId("a") })) },
    })),
    edges: payload.edges
      .filter((e) => ids.has(e.source) && ids.has(e.target))
      .map((e) => ({ ...e, id: newId("e"), source: ids.get(e.source)!, target: ids.get(e.target)! })),
  };
}
