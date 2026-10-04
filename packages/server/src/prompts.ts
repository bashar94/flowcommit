import { NODE_KIND_INFO, NODE_KINDS, type WriteRequestSchema } from "@flowcommit/shared";
import type { z } from "zod";

type WriteRequest = z.infer<typeof WriteRequestSchema>;

export const WRITE_SYSTEM = `You are the writing assistant inside FlowCommit, an app where people design software as a flowchart and AI coding agents build the code from it.
You rewrite the text of exactly one field. Reply with only the new text for that field: no preamble, no explanation, no quotes around it, and no code fences.
Keep the author's intent and language. Never add features the author didn't ask for.`;

const FIELD_NAME = {
  instructions: "the instructions an AI coding agent will follow to build this step",
  title: "the title of this step (2 to 6 words, no period)",
  description: "the description of the whole app",
  caption: "a caption that tells the AI coding agent what to notice in an attached image or video",
} as const;

const ACTION = {
  clarify: {
    instructions:
      "Rewrite it so an AI coding agent can build this step without guessing. Be specific about what the user sees, the data involved, validation and error cases. Use short sentences or a short bulleted list. Finish with a line 'Done when:' followed by 2 to 4 checkable bullet points.",
    title: "Rewrite it as a clear, specific title of 2 to 6 words.",
    description:
      "Rewrite it as 2 to 4 clear sentences: who the app is for, what they do with it, and what matters most.",
    caption: "Rewrite it to say exactly what the AI should copy or notice in the attachment.",
  },
  write: {
    instructions:
      "Write it from scratch using the step's title and its place in the flow. Be specific about what the user sees, the data involved, validation and error cases. Finish with a line 'Done when:' followed by 2 to 4 checkable bullet points.",
    title: "Write a clear title of 2 to 6 words that fits this step's instructions and place in the flow.",
    description:
      "Write 2 to 4 sentences describing the app from its name and steps: who it's for, what they do, and what matters most.",
    caption: "Write a one-sentence caption for the attachment based on the step it belongs to.",
  },
  grammar: "Fix spelling, grammar and punctuation only. Keep the wording and meaning otherwise unchanged.",
  shorten: "Make it shorter and clearer while keeping every requirement.",
  custom: "",
} as const;

export function writePrompt(req: WriteRequest): string {
  const { context: c } = req;
  const task =
    req.action === "custom"
      ? `Change it as the author asks: ${req.instruction}`
      : req.action === "grammar" || req.action === "shorten"
        ? ACTION[req.action]
        : ACTION[req.action][req.field];

  const lines = [
    `Field: ${FIELD_NAME[req.field]}.`,
    `Task: ${task}`,
    "",
    "Context about the flow:",
    `- App name: ${c.flowName || "(not set)"}`,
    `- App description: ${c.flowDescription || "(not set)"}`,
  ];
  if (c.step) {
    lines.push(`- This step is a ${NODE_KIND_INFO[c.step.kind].label} step (${NODE_KIND_INFO[c.step.kind].hint.toLowerCase()}).`);
    lines.push(`- Step title: ${c.step.title || "(untitled)"}`);
    if (req.field !== "instructions" && c.step.instructions) lines.push(`- Step instructions: ${c.step.instructions}`);
  }
  if (c.previous.length) lines.push(`- Steps that lead here: ${c.previous.join("; ")}`);
  if (c.next.length) lines.push(`- Steps that come next: ${c.next.join("; ")}`);
  lines.push("", "Current text of the field:", req.text ? `<<<\n${req.text}\n>>>` : "(empty)");
  return lines.join("\n");
}

export const DRAFT_SYSTEM = `You design flowcharts for FlowCommit, an app where people plan software as a flowchart and AI coding agents build it step by step.
Reply with one JSON object and nothing else.`;

export function draftPrompt(description: string): string {
  const kinds = NODE_KINDS.map((k) => `"${k}" (${NODE_KIND_INFO[k].hint.toLowerCase()})`).join(", ");
  return `Draft the main user flow for this app:

<<<
${description}
>>>

Reply with JSON in exactly this shape:
{
  "name": "Short app name",
  "steps": [
    { "id": "s1", "kind": "start", "title": "User opens the app", "instructions": "..." }
  ],
  "arrows": [
    { "from": "s1", "to": "s2", "label": "" }
  ]
}

Rules:
- "kind" is one of: ${kinds}.
- Begin with exactly one "start" step and finish with at least one "end" step.
- Use 6 to 14 steps. Cover the main path first, plus the most important error or alternative path.
- A "decision" step has two or more outgoing arrows, each labeled with the answer (like "Yes" and "No").
- Use "screen" for pages the user sees, "api" for backend work, "data" for what gets stored.
- Titles are 2 to 6 words. Instructions are 1 to 3 specific sentences an AI coding agent can build from.
- Every arrow connects ids that exist in "steps".`;
}

export const IMPORT_SYSTEM = `You are reading an existing codebase to draw its flowchart for FlowCommit, an app where people plan software as a flowchart and AI coding agents build it step by step. From now on, the flowchart is how the person will understand and change this app, so it must describe what the code really does.
You can read files but you must not change anything. When you have read enough, reply with one JSON object and nothing else.`;

export function importPrompt(): string {
  const kinds = NODE_KINDS.map((k) => `"${k}" (${NODE_KIND_INFO[k].hint.toLowerCase()})`).join(", ");
  return `Read the code in the current folder and draw the app's main flow as it works today.

Start with the README, package or project files and the entry points, then follow the main paths through the code. Skip dependencies, build output and generated files.

Reply with JSON in exactly this shape:
{
  "name": "Short app name",
  "description": "One or two sentences on what the app is and who it's for.",
  "steps": [
    { "id": "s1", "kind": "start", "title": "User opens the app", "instructions": "...", "files": ["src/main.ts"], "done": true }
  ],
  "arrows": [
    { "from": "s1", "to": "s2", "label": "" }
  ]
}

Rules:
- "kind" is one of: ${kinds}.
- Begin with exactly one "start" step and finish with at least one "end" step.
- Use 6 to 16 steps for the paths a user actually takes, plus the most important error path. Group small details into one step rather than listing every function.
- A "decision" step has two or more outgoing arrows, each labeled with the answer (like "Yes" and "No").
- Titles are 2 to 6 words, in plain language a non-programmer understands.
- Instructions are 1 to 3 sentences describing what this step does in the code today, specific enough that an AI coding agent could rebuild or change it. Mention notable libraries or services by name.
- "files" lists the 1 to 5 source files that do this step, as paths relative to the current folder. Use [] for steps with no code of their own, like the start.
- "done" is false when the code only partly does the step (a stub, a TODO, a missing piece); say what's missing in the instructions.
- Every arrow connects ids that exist in "steps".`;
}
