import type { Edge, Node } from "@xyflow/react";
import { MarkerType } from "@xyflow/react";
import { SCHEMA_VERSION, type Attachment, type FlowFile, type FlowGroup, type NodeKind } from "@flowcommit/shared";

export type DiffMark = "added" | "removed" | "changed" | "moved";

/** The parts of a step that live in React Flow's `data` field. */
export type StepData = {
  kind: NodeKind;
  title: string;
  instructions: string;
  attachments: Attachment[];
  tags: string[];
  /** The id of the group this step is in, if any. */
  group?: string;
  /** For developers: where it is in the code, what it uses, and rules the code must follow. */
  codeRef?: string;
  uses?: string[];
  rules?: string[];
  /** Only set when comparing versions. */
  diff?: DiffMark;
  /** Version whose files this step's attachments come from. Unset means the current draft. */
  assetVersion?: string;
};

export type StepNode = Node<StepData, "step">;
export type ArrowSide = "left" | "right";
export type ArrowEdge = Edge<{ label: string }>;

export type FlowMeta = { name: string; description: string; groups: FlowGroup[]; stack: string[]; rules: string[] };

export const DEFAULT_EDGE_OPTIONS = {
  type: "smoothstep",
  markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
  pathOptions: { borderRadius: 14 },
  labelBgPadding: [8, 4] as [number, number],
  labelBgBorderRadius: 999,
} as const;

export function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

export function toCanvas(flow: FlowFile): { meta: FlowMeta; nodes: StepNode[]; edges: ArrowEdge[] } {
  return {
    meta: { name: flow.name, description: flow.description, groups: flow.groups, stack: flow.stack ?? [], rules: flow.rules ?? [] },
    nodes: flow.nodes.map((n) => ({
      id: n.id,
      type: "step",
      position: n.position,
      data: {
        kind: n.kind,
        title: n.title,
        instructions: n.instructions,
        attachments: n.attachments,
        tags: n.tags,
        ...(n.group ? { group: n.group } : {}),
        ...(n.codeRef ? { codeRef: n.codeRef } : {}),
        ...(n.uses?.length ? { uses: n.uses } : {}),
        ...(n.rules?.length ? { rules: n.rules } : {}),
      },
    })),
    edges: flow.edges.map((e) => toCanvasEdge(e.id, e.source, e.target, e.label, e.sourceHandle)),
  };
}

export function toCanvasEdge(
  id: string,
  source: string,
  target: string,
  label: string,
  sourceHandle?: string | null,
): ArrowEdge {
  return {
    id,
    source,
    target,
    sourceHandle: sourceHandle ?? undefined,
    label: label || undefined,
    data: { label },
    ...DEFAULT_EDGE_OPTIONS,
  };
}

export function fromCanvas(meta: FlowMeta, nodes: StepNode[], edges: ArrowEdge[]): FlowFile {
  // A group lasts as long as it has steps.
  const groups = meta.groups.filter((g) => nodes.some((n) => n.data.group === g.id));
  const groupIds = new Set(groups.map((g) => g.id));
  return {
    schema: SCHEMA_VERSION,
    name: meta.name,
    description: meta.description,
    ...(meta.stack.length ? { stack: meta.stack } : {}),
    ...(meta.rules.length ? { rules: meta.rules } : {}),
    groups,
    nodes: nodes.map((n) => ({
      id: n.id,
      kind: n.data.kind,
      title: n.data.title,
      instructions: n.data.instructions,
      attachments: n.data.attachments,
      tags: n.data.tags,
      ...(n.data.group && groupIds.has(n.data.group) ? { group: n.data.group } : {}),
      ...(n.data.codeRef?.trim() ? { codeRef: n.data.codeRef.trim() } : {}),
      ...(n.data.uses?.length ? { uses: n.data.uses } : {}),
      ...(n.data.rules?.some((r) => r.trim()) ? { rules: n.data.rules.map((r) => r.trim()).filter(Boolean) } : {}),
      position: n.position,
    })),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.data?.label ?? "",
      sourceHandle: e.sourceHandle === "left" || e.sourceHandle === "right" ? e.sourceHandle : undefined,
    })),
  };
}

export function assetUrl(src: string, version?: string): string {
  return version
    ? `/api/versions/${version}/assets/${encodeURIComponent(src)}`
    : `/api/assets/${encodeURIComponent(src)}`;
}
