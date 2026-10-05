/**
 * FlowCommit's MCP server. An AI coding agent (Claude Code, Codex, ...) starts it inside the
 * user's project and uses it to read the flowchart, take one step at a time, and report back.
 * The FlowCommit app watches the same files, so the canvas updates while the agent works.
 *
 * It talks over stdio, so nothing here may print to stdout except the protocol itself.
 */
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  FLOWCOMMIT_VERSION,
  NODE_KIND_INFO,
  buildPlan,
  buildProgress,
  buildView,
  SuggestedChangeSchema,
  describeAnnotations,
  describeSuggestion,
  hasPending,
  pendingChanges,
  riskyFile,
  scanText,
  type Suggestion,
  diffWords,
  specOf,
  type BuildStatus,
  type FlowFile,
  type FlowNode,
} from "@flowcommit/shared";
import { randomUUID } from "node:crypto";
import { Project } from "./project.ts";
import { fingerprint, refreshFingerprints } from "./codeSync.ts";

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

function projectRoot(): string {
  const i = process.argv.indexOf("--project");
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  // Claude Code starts project servers in the project folder, and may also say where it is.
  return process.env.FLOWCOMMIT_PROJECT ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
}

const project = new Project(projectRoot());

const INSTRUCTIONS = `FlowCommit holds the design of this app as a flowchart. Each step has instructions, and often mockups, written by the person you're building for. The flowchart and the code must stay in step, in both directions.

Design → code:
1. Call get_flow once to understand the whole app, and get_design_changes to see what's new since the last build.
2. Call next_step to get the next step to build, with its full instructions and images.
3. Call start_step, build that step in the codebase, then call finish_step with a short summary, every file you changed, where the step is in the code (code_ref) and the services it uses.
4. If the instructions are unclear or contradict each other, don't guess: call report_problem with a clear question, and move on to another step.
   Use the app's stack, and treat a step's rules (and the app's rules) as requirements. If a rule can't be met, call report_problem instead of working around it.
5. Steps removed from the design still have code. Remove it, then call confirm_removed.

Code → design:
Whenever you build or change something the flowchart doesn't show (a screen, an endpoint, data, a decision, an error path), or the code works differently from a step's instructions, call suggest_flow_change. The person reviews your suggestion in FlowCommit. This applies to every change you make in this project, even ones the person asks for directly in chat.

Never put passwords, API keys or tokens in the code or the flow: read them from environment variables, keep them in a .env file listed in .gitignore, and add a .env.example with placeholders. FlowCommit checks for secrets when the person saves or pushes.

Never edit .flowcommit/ yourself. The person edits the design in the FlowCommit app.`;

const server = new McpServer({ name: "flowcommit", version: FLOWCOMMIT_VERSION }, { instructions: INSTRUCTIONS });

const VIEW_LABEL = {
  todo: "not built yet",
  building: "being built",
  built: "built",
  outdated: "changed since built, needs rebuilding",
  blocked: "blocked, waiting for the person",
} as const;

const text = (t: string) => ({ type: "text" as const, text: t });

/** Passwords and keys in the files an agent just wrote, described without repeating them. */
async function secretsIn(files: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const f of files) {
    const full = path.resolve(project.root, f);
    if (path.relative(project.root, full).startsWith("..")) continue;
    const reason = riskyFile(f);
    if (reason) out.push(`${f}: ${reason.toLowerCase()}; make sure it's in .gitignore`);
    const body = await readFile(full, "utf8").catch(() => "");
    if (body.length > 1024 * 1024) continue;
    for (const s of scanText(f, body)) out.push(`${f}, line ${s.line}: ${s.label} (${s.preview})`);
  }
  return out;
}
const groupNote = (flow: FlowFile, id?: string) => {
  const g = id && flow.groups.find((x) => x.id === id);
  return g ? ` (in "${g.title}")` : "";
};
const fail = (message: string) => ({ content: [text(message)], isError: true });

async function load(): Promise<{ flow: FlowFile; status: BuildStatus }> {
  const [flow, status] = await Promise.all([project.readFlow(), project.readStatus()]);
  return { flow, status };
}

/** MCP clients report names like "claude-code"; people know the product name. */
function agentLabel(name: string): string {
  if (/claude/i.test(name)) return "Claude Code";
  if (/codex/i.test(name)) return "Codex";
  return name;
}

function agentName(): string {
  const info = server.server.getClientVersion();
  return info?.name ?? "AI agent";
}

function titleOf(flow: FlowFile, id: string) {
  return flow.nodes.find((n) => n.id === id)?.title || "Untitled step";
}

type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

async function pushImage(content: Content[], file: string, lines: string[]) {
  const type = IMAGE_TYPES[path.extname(file).toLowerCase()];
  if (!type) return;
  try {
    if ((await stat(file)).size <= MAX_IMAGE_BYTES) {
      content.push({ type: "image", data: (await readFile(file)).toString("base64"), mimeType: type });
    }
  } catch {
    lines.push(`  (${path.basename(file)} is missing)`);
  }
}

/** Everything an agent needs to build one step: the instructions, connections and attachments. */
async function describeStep(flow: FlowFile, status: BuildStatus, node: FlowNode) {
  const record = status.steps[node.id];
  const view = buildView(node, record);
  const incoming = flow.edges.filter((e) => e.target === node.id);
  const outgoing = flow.edges.filter((e) => e.source === node.id);
  const arrow = (id: string, label: string) => `"${titleOf(flow, id)}" (${id})${label ? ` when "${label}"` : ""}`;

  const lines = [
    `# ${node.title || "Untitled step"}`,
    `- Step id: ${node.id}`,
    `- Type: ${NODE_KIND_INFO[node.kind].label} (${NODE_KIND_INFO[node.kind].hint.toLowerCase()})`,
    `- Status: ${VIEW_LABEL[view]}`,
  ];
  if (node.tags.length) lines.push(`- Tags: ${node.tags.join(", ")}`);
  if (node.codeRef) lines.push(`- In the code: ${node.codeRef}`);
  if (node.uses?.length) lines.push(`- Uses: ${node.uses.join(", ")}`);
  if (flow.stack?.length) lines.push(`- The app is built with: ${flow.stack.join(", ")}`);
  if (incoming.length) lines.push(`- Comes after: ${incoming.map((e) => arrow(e.source, e.label)).join("; ")}`);
  if (outgoing.length) lines.push(`- Leads to: ${outgoing.map((e) => arrow(e.target, e.label)).join("; ")}`);
  lines.push("", "## Instructions", node.instructions.trim() || "(No instructions. Build what the title and the flow around it imply.)");
  const rules = [...(node.rules ?? []), ...(flow.rules ?? [])].filter((r) => r.trim());
  if (rules.length) {
    lines.push("", "## Rules the code must follow (requirements, not suggestions)", ...rules.map((r) => `- ${r}`));
  }

  if (view === "outdated" && record?.builtSpec) {
    const before = record.builtSpec;
    lines.push("", "## Changed since you built it");
    if (before.title !== node.title) lines.push(`- Title was "${before.title}"`);
    if (before.kind !== node.kind) lines.push(`- Type was ${NODE_KIND_INFO[before.kind].label}`);
    if (before.instructions !== node.instructions) {
      const marked = diffWords(before.instructions, node.instructions)
        .map((c) => (c.type === "added" ? `[+${c.text}+]` : c.type === "removed" ? `[-${c.text}-]` : c.text))
        .join("");
      lines.push("- Instructions, with [+added+] and [-removed-] text:", marked);
    }
    const ids = (list: { id: string }[]) => new Set(list.map((a) => a.id));
    const added = node.attachments.filter((a) => !ids(before.attachments).has(a.id));
    const removed = before.attachments.filter((a) => !ids(node.attachments).has(a.id));
    if (added.length) lines.push(`- New attachments: ${added.map((a) => a.caption || a.src).join("; ")}`);
    const remarked = node.attachments.filter((a) => {
      const old = before.attachments.find((b) => b.id === a.id);
      return old && JSON.stringify(old.annotations) !== JSON.stringify(a.annotations);
    });
    if (remarked.length) {
      lines.push(`- The marks on ${remarked.length === 1 ? "an image" : `${remarked.length} images`} changed. The current notes are under Attachments.`);
    }
    if (removed.length) lines.push(`- Removed attachments: ${removed.map((a) => a.caption || a.src).join("; ")}`);
    if ((before.codeRef ?? "") !== (node.codeRef ?? "")) lines.push(`- In the code: was "${before.codeRef ?? ""}", now "${node.codeRef ?? ""}"`);
    const listChange = (label: string, was: string[] = [], now: string[] = []) => {
      const add = now.filter((x) => !was.includes(x));
      const drop = was.filter((x) => !now.includes(x));
      if (add.length || drop.length) {
        lines.push(`- ${label}: ${[add.length ? `added ${add.join(", ")}` : "", drop.length ? `removed ${drop.join(", ")}` : ""].filter(Boolean).join("; ")}`);
      }
    };
    listChange("Uses", before.uses, node.uses);
    listChange("Rules", before.rules, node.rules);
    if (record.files.length) lines.push(`- Files you changed last time: ${record.files.join(", ")}`);
  } else if (record?.note) {
    lines.push("", view === "blocked" ? "## Open question" : "## Last build", record.note);
  }

  const content: Content[] = [];
  const attachmentLines: string[] = [];
  for (const a of node.attachments) {
    const caption = a.caption ? ` — ${a.caption}` : "";
    if (a.kind === "link") {
      attachmentLines.push(`- Link: ${a.src}${caption}`);
      continue;
    }
    const file = path.join(project.assetsDir, a.src);
    attachmentLines.push(`- ${a.kind === "image" ? "Image" : "Video"} at ${file}${caption}`);
    if (a.kind !== "image") continue;

    // A marked-up image comes first, so the agent sees the numbered marks next to the notes.
    if (a.annotations.length) {
      if (a.annotatedSrc) {
        const marked = path.join(project.assetsDir, a.annotatedSrc);
        attachmentLines.push(`  Marked-up copy, with the numbers drawn on it: ${marked}`);
        await pushImage(content, marked, attachmentLines);
      }
      attachmentLines.push("  The person marked these places on the image. Follow each note:");
      attachmentLines.push(...describeAnnotations(a.annotations).map((l) => `    ${l}`));
    }
    await pushImage(content, file, attachmentLines);
  }
  if (attachmentLines.length) lines.push("", "## Attachments", ...attachmentLines);

  return [text(lines.join("\n")), ...content];
}

server.registerTool(
  "get_flow",
  {
    title: "Get the app's flowchart",
    description:
      "Read the whole app design: what it is, every step in order with its type and build status, and how the steps connect. Call this first.",
    annotations: { readOnlyHint: true },
  },
  async () => {
    const { flow, status } = await load();
    const plan = buildPlan(flow, status);
    const progress = buildProgress(flow, status);
    const lines = [
      `# ${flow.name || "Untitled app"}`,
      flow.description || "(No description.)",
      ...(flow.stack?.length ? ["", `Built with: ${flow.stack.join(", ")}. Use these; ask before adding another framework or service.`] : []),
      ...(flow.rules?.length ? ["", "Rules every step must follow:", ...flow.rules.map((r) => `- ${r}`)] : []),
      "",
      `Build progress: ${progress.built} of ${progress.total} steps built.`,
      "",
      ...(flow.groups.length
        ? [
            "## Parts of the app",
            "The person grouped steps into these parts. Keep each part's code together where it makes sense.",
            ...flow.groups.map(
              (g) => `- ${g.title || "Untitled group"}: ${flow.nodes.filter((n) => n.group === g.id).map((n) => n.title || "Untitled").join(", ")}`,
            ),
            "",
          ]
        : []),
      "## Steps, in reading order",
      ...plan.map(
        (p, i) =>
          `${i + 1}. [${p.node.id}] ${NODE_KIND_INFO[p.node.kind].label}: ${p.node.title || "Untitled"}${groupNote(flow, p.node.group)}${p.node.codeRef ? ` \`${p.node.codeRef}\`` : ""}${p.node.uses?.length ? ` (uses ${p.node.uses.join(", ")})` : ""}${p.node.tags.length ? ` #${p.node.tags.join(" #")}` : ""} — ${VIEW_LABEL[p.view]}`,
      ),
      "",
      "## Arrows",
      ...flow.edges.map(
        (e) => `- ${titleOf(flow, e.source)} → ${titleOf(flow, e.target)}${e.label ? ` (${e.label})` : ""}`,
      ),
    ];
    return { content: [text(lines.join("\n"))] };
  },
);

server.registerTool(
  "next_step",
  {
    title: "Get the next step to build",
    description:
      "Returns the next step that needs building, with its full instructions and mockup images. Steps that changed since they were built come first. Returns nothing when everything is built.",
    annotations: { readOnlyHint: true },
  },
  async () => {
    const { flow, status } = await load();
    const plan = buildPlan(flow, status);
    const pending = plan.filter((p) => p.view === "todo" || p.view === "outdated");
    const next =
      pending.find((p) => p.view === "outdated") ?? pending.find((p) => p.waitingOn.length === 0) ?? pending[0];
    if (!next) {
      const blocked = plan.filter((p) => p.view === "blocked");
      return {
        content: [
          text(
            blocked.length
              ? `Nothing left to build except blocked steps waiting for the person: ${blocked.map((p) => p.node.title).join(", ")}.`
              : pendingChanges(flow, status).removed.length
                ? "Every step is built, but some steps were removed from the design and still have code. Call get_design_changes."
                : "Every step is built. Tell the person the app matches the flowchart.",
          ),
        ],
      };
    }
    const after = pending.length - 1;
    return {
      content: [
        ...(await describeStep(flow, status, next.node)),
        text(`\n${after} more ${after === 1 ? "step" : "steps"} to build after this one.`),
      ],
    };
  },
);

server.registerTool(
  "get_step",
  {
    title: "Get one step",
    description: "Full instructions, connections and mockup images for one step, by its id.",
    inputSchema: { step_id: z.string().describe("The step id, like n-1a2b3c4d") },
    annotations: { readOnlyHint: true },
  },
  async ({ step_id }) => {
    const { flow, status } = await load();
    const node = flow.nodes.find((n) => n.id === step_id);
    if (!node) return fail(`There's no step with id ${step_id}. Call get_flow to see the step ids.`);
    return { content: await describeStep(flow, status, node) };
  },
);

server.registerTool(
  "start_step",
  {
    title: "Start building a step",
    description: "Marks a step as being built, so the person sees it light up in FlowCommit. Call this before you change any code for it.",
    inputSchema: { step_id: z.string() },
  },
  async ({ step_id }) => {
    const { flow } = await load();
    const node = flow.nodes.find((n) => n.id === step_id);
    if (!node) return fail(`There's no step with id ${step_id}.`);
    await project.updateStep(step_id, (current) => ({
      state: "building",
      note: "",
      files: current?.files ?? [],
      fileHashes: current?.fileHashes ?? {},
      agent: agentName(),
      updatedAt: new Date().toISOString(),
      builtSpec: current?.builtSpec ?? null,
    }));
    return { content: [text(`Started "${node.title}". Build it, then call finish_step.`)] };
  },
);

server.registerTool(
  "finish_step",
  {
    title: "Finish a step",
    description: "Marks a step as built and records what you did. The person sees the summary in FlowCommit.",
    inputSchema: {
      step_id: z.string(),
      summary: z.string().describe("One or two sentences, in plain language, on what you built."),
      files: z.array(z.string()).default([]).describe("Paths of the files you created or changed, relative to the project."),
      code_ref: z
        .string()
        .optional()
        .describe('Where the step now is in the code, briefly: a route ("/cart"), an endpoint ("POST /api/checkout"), a table ("orders"), or a function.'),
      uses: z.array(z.string()).optional().describe('Services and main libraries this step uses, like ["Stripe", "Zod"].'),
    },
  },
  async ({ step_id, summary, files, code_ref, uses }) => {
    const { flow } = await load();
    const node = flow.nodes.find((n) => n.id === step_id);
    if (!node) return fail(`There's no step with id ${step_id}.`);
    // Fingerprint the files, so FlowCommit notices if they're edited later outside a build.
    const fileHashes = await fingerprint(project, files);
    await refreshFingerprints(project, files, fileHashes);
    const status = await project.updateStep(step_id, () => ({
      state: "built",
      note: summary,
      files,
      fileHashes,
      agent: agentName(),
      updatedAt: new Date().toISOString(),
      builtSpec: specOf(node),
      ...(code_ref ? { codeRef: code_ref.slice(0, 120) } : {}),
      ...(uses?.length ? { uses: uses.slice(0, 12) } : {}),
    }));
    const progress = buildProgress(flow, status);
    const leaks = await secretsIn(files);
    return {
      content: [
        text(`Marked "${node.title}" as built. ${progress.built} of ${progress.total} steps are built. Call next_step to continue.`),
        ...(leaks.length
          ? [
              text(
                `Warning: these look like secrets written into the code. Move each one into an environment variable (in a .env file listed in .gitignore) before continuing:\n${leaks.map((l) => `- ${l}`).join("\n")}`,
              ),
            ]
          : []),
      ],
    };
  },
);

server.registerTool(
  "report_problem",
  {
    title: "Ask the person about a step",
    description:
      "Use when a step's instructions are unclear, contradict each other or can't be built. The step shows your question in FlowCommit until the person updates it.",
    inputSchema: {
      step_id: z.string(),
      question: z.string().describe("What you need from the person, as a clear question."),
    },
  },
  async ({ step_id, question }) => {
    const { flow } = await load();
    const node = flow.nodes.find((n) => n.id === step_id);
    if (!node) return fail(`There's no step with id ${step_id}.`);
    await project.updateStep(step_id, (current) => ({
      state: "blocked",
      note: question,
      files: current?.files ?? [],
      fileHashes: current?.fileHashes ?? {},
      agent: agentName(),
      updatedAt: new Date().toISOString(),
      builtSpec: current?.builtSpec ?? null,
    }));
    return { content: [text(`Your question is showing on "${node.title}" in FlowCommit. Continue with another step.`)] };
  },
);

server.registerTool(
  "get_design_changes",
  {
    title: "What changed in the design",
    description:
      "Everything in the flowchart the code hasn't caught up with: steps edited since you built them, steps never built, and steps removed from the design whose code should be removed. Also lists suggestions of yours still waiting for the person.",
    annotations: { readOnlyHint: true },
  },
  async () => {
    const { flow, status } = await load();
    const p = pendingChanges(flow, status);
    const waiting = (await project.readSuggestions()).suggestions;
    const list = (nodes: { id: string; title: string }[]) => nodes.map((n) => `- [${n.id}] ${n.title}`);
    const lines = [
      hasPending(p) ? "# The design has changed" : "# The code matches the design",
      ...(p.changed.length ? ["", "## Edited since you built them (get_step shows exactly what changed)", ...list(p.changed)] : []),
      ...(p.added.length ? ["", "## Not built yet", ...list(p.added)] : []),
      ...(p.removed.length
        ? ["", "## Removed from the design: remove their code, then call confirm_removed", ...p.removed.map((r) => `- [${r.id}] ${r.title}${r.files.length ? ` (files: ${r.files.join(", ")})` : ""}`)]
        : []),
      ...(p.blocked.length ? ["", "## Waiting for the person to answer your question", ...list(p.blocked)] : []),
      ...(waiting.length
        ? ["", `## ${waiting.length === 1 ? "1 flow suggestion is" : `${waiting.length} flow suggestions are`} waiting for the person to review`, ...waiting.map((w) => `- ${describeSuggestion(w, flow)}`)]
        : []),
    ];
    return { content: [text(lines.join("\n"))] };
  },
);

server.registerTool(
  "suggest_flow_change",
  {
    title: "Suggest a change to the flowchart",
    description:
      "Propose a flowchart change when the code does something the flowchart doesn't show, or works differently from it. The person accepts or dismisses it in FlowCommit; you never change the flowchart directly. Use step ids from get_flow.",
    inputSchema: {
      reason: z.string().describe("Why, in one plain sentence: what the code does that the flowchart doesn't show."),
      files: z.array(z.string()).default([]).describe("Code files that show it, relative to the project."),
      change: SuggestedChangeSchema.describe(
        'One of: {"type":"add-step","step":{"kind":"screen","title":"Login","instructions":"..."},"after":"<step id>","before":"<step id, optional>","label":"<arrow label, optional>"}; {"type":"edit-step","stepId":"<id>","addInstructions":"<a sentence to add to the end>"} (preferred: keeps the person\'s wording), or "title"/"instructions" to replace them; {"type":"remove-step","stepId":"<id>"}; {"type":"add-arrow","from":"<id>","to":"<id>","label":"..."}; {"type":"remove-arrow","from":"<id>","to":"<id>"}',
      ),
    },
  },
  async ({ reason, files, change }) => {
    const { flow } = await load();
    const ids = new Set(flow.nodes.map((n) => n.id));
    const refs =
      change.type === "add-step"
        ? [change.after, change.before]
        : change.type === "edit-step" || change.type === "remove-step"
          ? [change.stepId]
          : [change.from, change.to];
    const unknown = refs.filter((r) => r && !ids.has(r));
    if (unknown.length) return fail(`There's no step with id ${unknown.join(", ")}. Call get_flow to see the step ids.`);
    const suggestion: Suggestion = {
      id: randomUUID().slice(0, 10),
      createdAt: new Date().toISOString(),
      source: agentLabel(agentName()),
      reason,
      files,
      change,
    };
    await project.addSuggestions([suggestion]);
    return {
      content: [text(`Suggested: ${describeSuggestion(suggestion, flow)}. It's waiting for the person to review in FlowCommit. Carry on with your work.`)],
    };
  },
);

server.registerTool(
  "confirm_removed",
  {
    title: "Confirm a removed step's code is gone",
    description: "Call after removing the code of a step that was deleted from the design (see get_design_changes).",
    inputSchema: { step_id: z.string(), summary: z.string().describe("What you removed, in one sentence.") },
  },
  async ({ step_id }) => {
    const { flow, status } = await load();
    if (flow.nodes.some((n) => n.id === step_id)) return fail("That step is still in the design. Only confirm steps that were removed.");
    if (!status.steps[step_id]) return fail(`There's no record of step ${step_id}.`);
    await project.updateStep(step_id, () => null);
    return { content: [text("Done. FlowCommit no longer lists that step's code as left over.")] };
  },
);

server.registerPrompt(
  "sync",
  {
    title: "Bring the code in line with the FlowCommit flowchart",
    description: "Builds what's new, rebuilds what changed and removes what was deleted from the design.",
  },
  () => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text:
            "Bring the code in line with the FlowCommit flowchart. Call get_design_changes, then rebuild edited steps, build new ones, and remove the code of deleted ones (confirm_removed). " +
            "If you find code the flowchart doesn't describe, call suggest_flow_change for each difference. Finish with a short summary.",
        },
      },
    ],
  }),
);

server.registerPrompt(
  "build",
  {
    title: "Build the app from the FlowCommit flowchart",
    description: "Builds every step that isn't built yet, one at a time.",
  },
  () => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text:
            "Build this app from its FlowCommit flowchart. Start with get_flow, then repeat next_step → start_step → build it → finish_step until every step is built. " +
            "Ask with report_problem instead of guessing. When you're done, summarize what you built and anything you need from me.",
        },
      },
    ],
  }),
);

await server.connect(new StdioServerTransport());
