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

// The descriptions below also go into the published JSON Schema (schema/flow.schema.json).

export const AnnotationSchema = z
  .object({
    id: z.string(),
    kind: z.enum(ANNOTATION_KINDS).describe("box: two corners. arrow: from its first point to its second. pin: one point. pen: a drawing."),
    color: z.enum(ANNOTATION_COLORS).default("red"),
    points: z
      .array(z.tuple([z.number(), z.number()]))
      .min(1)
      .max(4000)
      .describe("Points as fractions of the image's width and height (0 to 1), so marks fit any size."),
    note: z.string().default("").describe("What to change at this spot."),
  })
  .describe("A numbered mark drawn on an image, with a note saying what to change there.");
export type Annotation = z.infer<typeof AnnotationSchema>;

export const AttachmentSchema = z
  .object({
    id: z.string(),
    kind: z.enum(["image", "video", "link"]),
    src: z.string().describe("For images and videos, a file name in .flowcommit/assets/. For links, a full URL."),
    caption: z.string().default(""),
    annotations: z.array(AnnotationSchema).default([]),
    annotatedSrc: z
      .string()
      .optional()
      .describe("A copy of the image with the numbered marks drawn on it, in .flowcommit/assets/, for AI tools to look at."),
  })
  .describe("An image, video or link that explains a step.");
export type Attachment = z.infer<typeof AttachmentSchema>;

export const FlowNodeSchema = z
  .object({
    id: z.string().describe("Unique within the flow. Never reused, so versions can be compared step by step."),
    kind: z.enum(NODE_KINDS).describe("The type of step, which sets its shape."),
    title: z.string().describe("A few words, like \"Charge the card\"."),
    instructions: z.string().default("").describe("What to build, for the AI agent. Markdown is allowed."),
    attachments: z.array(AttachmentSchema).default([]),
    tags: z.array(z.string()).default([]).describe('Short labels, like "auth" or "MVP".'),
    group: z.string().optional().describe("The id of the group this step is in, if any."),
    codeRef: z
      .string()
      .optional()
      .describe("Where the step is in the code: a screen's route, an API's method and path, a table's name, a function."),
    uses: z.array(z.string()).optional().describe('Services and libraries the step uses, like "Stripe" or "Supabase".'),
    rules: z.array(z.string()).optional().describe("Requirements the code must follow, like \"Never store card numbers\"."),
    position: z
      .object({ x: z.number(), y: z.number() })
      .describe("Where the step sits on the canvas, in pixels. Moving a step isn't a design change."),
  })
  .describe("One step of the flow.");
export type FlowNode = z.infer<typeof FlowNodeSchema>;

export const FlowEdgeSchema = z
  .object({
    id: z.string(),
    source: z.string().describe("The id of the step the arrow starts at."),
    target: z.string().describe("The id of the step the arrow points to."),
    label: z.string().default("").describe('Shown on the arrow, like "Yes" or "No" after a decision.'),
    sourceHandle: z
      .enum(["left", "right"])
      .optional()
      .describe("Which corner of a decision the arrow leaves from. Leave it out for the bottom."),
  })
  .describe("An arrow from one step to the next.");
export type FlowEdge = z.infer<typeof FlowEdgeSchema>;

export const FlowGroupSchema = z
  .object({
    id: z.string(),
    title: z.string(),
  })
  .describe('A named part of the flow, like "Checkout". Its steps are the ones whose group is this id.');
export type FlowGroup = z.infer<typeof FlowGroupSchema>;

export const FlowFileSchema = z
  .object({
    schema: z.literal(SCHEMA_VERSION).describe("The version of this format."),
    name: z.string().describe("The app's name."),
    description: z.string().default("").describe("What the app is. AI agents read this before every step."),
    groups: z.array(FlowGroupSchema).default([]),
    stack: z.array(z.string()).optional().describe('What the app is built with, like "Next.js", "Postgres", "Stripe".'),
    rules: z.array(z.string()).optional().describe("Requirements every step must follow."),
    nodes: z.array(FlowNodeSchema),
    edges: z.array(FlowEdgeSchema),
  })
  .describe("A FlowCommit flow: an app's design as steps and arrows, stored in .flowcommit/flow.json.");
export type FlowFile = z.infer<typeof FlowFileSchema>;

export function createEmptyFlow(name: string): FlowFile {
  return {
    schema: SCHEMA_VERSION,
    name,
    description: "",
    groups: [],
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
  const ordered: Omit<FlowFile, "groups"> & { groups?: FlowGroup[] } = {
    schema: flow.schema,
    name: flow.name,
    description: flow.description,
    // Left out when empty, so flows without groups look the same as before groups existed.
    ...(flow.stack?.length ? { stack: flow.stack } : {}),
    ...(flow.rules?.length ? { rules: flow.rules } : {}),
    ...(flow.groups.length ? { groups: [...flow.groups].sort(byId).map((g) => ({ id: g.id, title: g.title })) } : {}),
    nodes: [...flow.nodes].sort(byId).map((n) => ({
      id: n.id,
      kind: n.kind,
      title: n.title,
      instructions: n.instructions,
      attachments: n.attachments.map(serializeAttachment),
      tags: n.tags,
      ...(n.group ? { group: n.group } : {}),
      ...(n.codeRef ? { codeRef: n.codeRef } : {}),
      ...(n.uses?.length ? { uses: n.uses } : {}),
      ...(n.rules?.length ? { rules: n.rules } : {}),
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
  // A step in a group that no longer exists is simply ungrouped, and empty groups are dropped.
  const groupIds = new Set(flow.groups.map((g) => g.id));
  for (const n of flow.nodes) if (n.group && !groupIds.has(n.group)) delete n.group;
  const used = new Set(flow.nodes.map((n) => n.group).filter(Boolean));
  flow.groups = flow.groups.filter((g) => used.has(g.id));
  for (const e of flow.edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) {
      throw new Error(`Arrow ${e.id} points at a step that doesn't exist.`);
    }
  }
  return flow;
}


/** FlowCommit's own version, shown to plugins and AI tools. */
export const FLOWCOMMIT_VERSION = "0.2.0";
