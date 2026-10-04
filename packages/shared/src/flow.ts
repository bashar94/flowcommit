import { z } from "zod";

/**
 * The flow file (`.flowcommit/flow.json`) is the spec that AI agents build from.
 * It only holds design intent. Runtime state such as build status lives elsewhere,
 * so that saving a version only ever shows real design changes in the diff.
 */

export const FLOW_DIR = ".flowcommit";
export const FLOW_FILE = "flow.json";
export const ASSETS_DIR = "assets";
export const SCHEMA_VERSION = 1;

export const NODE_KINDS = ["start", "step", "decision", "screen", "api", "data", "end"] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

export const NODE_KIND_INFO: Record<NodeKind, { label: string; hint: string }> = {
  start: { label: "Start", hint: "Where the flow begins" },
  step: { label: "Step", hint: "Something the app does" },
  decision: { label: "Decision", hint: "A yes/no or branching choice" },
  screen: { label: "Screen", hint: "A page or view the user sees" },
  api: { label: "API", hint: "A backend endpoint or external service" },
  data: { label: "Data", hint: "Something stored, like a table or file" },
  end: { label: "End", hint: "Where the flow finishes" },
};

export const ANNOTATION_KINDS = ["box", "arrow", "pin", "pen"] as const;
export type AnnotationKind = (typeof ANNOTATION_KINDS)[number];
export const ANNOTATION_COLORS = ["red", "yellow", "blue", "green"] as const;
export type AnnotationColor = (typeof ANNOTATION_COLORS)[number];

/**
 * A numbered mark drawn on an image, with a note saying what to change there.
 * Points are fractions of the image's width and height (0 to 1), so they fit any size:
 * a box has two corners, an arrow goes from its first point to its second, a pin has one
 * point, and a drawing has many.
 */
export const AnnotationSchema = z.object({
  id: z.string(),
  kind: z.enum(ANNOTATION_KINDS),
  color: z.enum(ANNOTATION_COLORS).default("red"),
  points: z.array(z.tuple([z.number(), z.number()])).min(1).max(4000),
  note: z.string().default(""),
});
export type Annotation = z.infer<typeof AnnotationSchema>;

export const AttachmentSchema = z.object({
  id: z.string(),
  kind: z.enum(["image", "video", "link"]),
  /** Path relative to the assets folder for uploads, or a full URL for links. */
  src: z.string(),
  caption: z.string().default(""),
  annotations: z.array(AnnotationSchema).default([]),
  /** A copy of the image with the numbered marks drawn on it, for AI tools to look at. */
  annotatedSrc: z.string().optional(),
});
export type Attachment = z.infer<typeof AttachmentSchema>;

export const FlowNodeSchema = z.object({
  id: z.string(),
  kind: z.enum(NODE_KINDS),
  title: z.string(),
  /** Free-form instructions for the AI agent. Markdown is allowed. */
  instructions: z.string().default(""),
  attachments: z.array(AttachmentSchema).default([]),
  /** Short labels people add to group steps, like "auth" or "MVP". */
  tags: z.array(z.string()).default([]),
  position: z.object({ x: z.number(), y: z.number() }),
});
export type FlowNode = z.infer<typeof FlowNodeSchema>;

export const FlowEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  label: z.string().default(""),
  /** Which side of the source step the arrow leaves from. Only decisions have more than one. */
  sourceHandle: z.enum(["left", "right"]).optional(),
});
export type FlowEdge = z.infer<typeof FlowEdgeSchema>;

export const FlowFileSchema = z.object({
  schema: z.literal(SCHEMA_VERSION),
  name: z.string(),
  description: z.string().default(""),
  nodes: z.array(FlowNodeSchema),
  edges: z.array(FlowEdgeSchema),
});
export type FlowFile = z.infer<typeof FlowFileSchema>;

export function createEmptyFlow(name: string): FlowFile {
  return {
    schema: SCHEMA_VERSION,
    name,
    description: "",
    nodes: [
      {
        id: "start",
        kind: "start",
        title: "User opens the app",
        instructions: "",
        attachments: [],
        tags: [],
        position: { x: 0, y: 0 },
      },
    ],
    edges: [],
  };
}

/**
 * Serializes a flow so that Git diffs stay small and meaningful:
 * nodes and edges are sorted by id, positions are rounded, and keys keep a fixed order.
 */
export function serializeFlow(flow: FlowFile): string {
  const byId = <T extends { id: string }>(a: T, b: T) => a.id.localeCompare(b.id);
  const ordered: FlowFile = {
    schema: flow.schema,
    name: flow.name,
    description: flow.description,
    nodes: [...flow.nodes].sort(byId).map((n) => ({
      id: n.id,
      kind: n.kind,
      title: n.title,
      instructions: n.instructions,
      attachments: n.attachments.map(serializeAttachment),
      tags: n.tags,
      position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
    })),
    edges: [...flow.edges].sort(byId).map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.label,
      ...(e.sourceHandle ? { sourceHandle: e.sourceHandle } : {}),
    })),
  };
  return JSON.stringify(ordered, null, 2) + "\n";
}

const round = (v: number) => Math.round(v * 10_000) / 10_000;

/** Fixed key order and rounded points keep annotation diffs small. */
export function serializeAttachment(a: Attachment): Attachment {
  return {
    id: a.id,
    kind: a.kind,
    src: a.src,
    caption: a.caption,
    annotations: a.annotations.map((m) => ({
      id: m.id,
      kind: m.kind,
      color: m.color,
      points: m.points.map(([x, y]) => [round(x), round(y)] as [number, number]),
      note: m.note,
    })),
    ...(a.annotatedSrc ? { annotatedSrc: a.annotatedSrc } : {}),
  };
}

/** Throws a readable error when the flow is invalid, including edges that point at missing nodes. */
export function parseFlow(input: unknown): FlowFile {
  const flow = FlowFileSchema.parse(input);
  const ids = new Set(flow.nodes.map((n) => n.id));
  if (ids.size !== flow.nodes.length) throw new Error("Two steps share the same id.");
  for (const e of flow.edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) {
      throw new Error(`Arrow ${e.id} points at a step that doesn't exist.`);
    }
  }
  return flow;
}

