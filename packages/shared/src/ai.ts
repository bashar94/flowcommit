import { z } from "zod";
import { NODE_KINDS } from "./flow.ts";

export const PROVIDER_IDS = ["claude", "codex"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

/** Text fields that the AI can help write. */
export const WRITE_FIELDS = ["instructions", "title", "description", "caption"] as const;
export type WriteField = (typeof WRITE_FIELDS)[number];

export const WRITE_ACTIONS = ["clarify", "write", "grammar", "shorten", "custom"] as const;
export type WriteAction = (typeof WRITE_ACTIONS)[number];

export const WriteRequestSchema = z.object({
  provider: z.enum(PROVIDER_IDS),
  field: z.enum(WRITE_FIELDS),
  action: z.enum(WRITE_ACTIONS),
  text: z.string().max(20_000),
  /** What the user typed for a custom request, like "make it friendlier". */
  instruction: z.string().max(2_000).default(""),
  context: z.object({
    flowName: z.string().default(""),
    flowDescription: z.string().default(""),
    step: z
      .object({ kind: z.enum(NODE_KINDS), title: z.string(), instructions: z.string().default("") })
      .optional(),
    previous: z.array(z.string()).default([]),
    next: z.array(z.string()).default([]),
  }),
});
export type WriteRequest = z.input<typeof WriteRequestSchema>;

export const DraftRequestSchema = z.object({
  provider: z.enum(PROVIDER_IDS),
  description: z.string().min(1).max(5_000),
});

/** The shape the AI must reply with when it drafts a whole flow. */
export const DraftFlowSchema = z.object({
  name: z.string().default(""),
  steps: z
    .array(
      z.object({
        id: z.string(),
        kind: z.enum(NODE_KINDS),
        title: z.string(),
        instructions: z.string().default(""),
      }),
    )
    .min(2)
    .max(40),
  arrows: z.array(z.object({ from: z.string(), to: z.string(), label: z.string().default("") })).default([]),
});
export type DraftFlow = z.infer<typeof DraftFlowSchema>;

/**
 * A flow drawn from code that already exists. Each step lists the files that do it, so
 * FlowCommit can count those steps as built and notice when that code changes later.
 */
export const ImportedStepSchema = z.object({
  id: z.string(),
  kind: z.enum(NODE_KINDS),
  title: z.string(),
  instructions: z.string().default(""),
  files: z.array(z.string()).default([]),
  /** Where it is in the code: a route, an endpoint, a table, a function. */
  codeRef: z.string().default(""),
  uses: z.array(z.string()).default([]),
  /** The id of the part of the app it belongs to, from `parts`. */
  part: z.string().default(""),
  /** False when the code only partly does this step, like a stub or a TODO. */
  done: z.boolean().default(true),
});
export type ImportedStep = z.infer<typeof ImportedStepSchema>;

export const ImportedFlowSchema = DraftFlowSchema.extend({
  description: z.string().default(""),
  /** What the app is built with, like ["Next.js", "Postgres", "Stripe"]. */
  stack: z.array(z.string()).default([]),
  /** The app's parts (features and subsystems), each drawn as a group. */
  parts: z.array(z.object({ id: z.string(), title: z.string() })).default([]),
  steps: z.array(ImportedStepSchema).min(2).max(80),
});
export type ImportedFlow = z.infer<typeof ImportedFlowSchema>;

/**
 * One part of an app drawn from its code, to add to a flow that already exists. `connect` joins
 * it to the existing steps it starts from or leads back to.
 */
export const ImportedPartSchema = z.object({
  title: z.string(),
  steps: z.array(ImportedStepSchema.omit({ part: true })).min(1).max(30),
  arrows: z.array(z.object({ from: z.string(), to: z.string(), label: z.string().default("") })).default([]),
  connect: z
    .array(z.object({ from: z.string(), to: z.string(), label: z.string().default("") }))
    .default([])
    .describe("Arrows between an existing step's id and a new step's id, either way round."),
  /** Services this part uses that the app's stack doesn't list yet. */
  stack: z.array(z.string()).default([]),
});
export type ImportedPart = z.infer<typeof ImportedPartSchema>;
