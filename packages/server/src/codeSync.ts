import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { nanoid } from "nanoid";
import {
  NODE_KINDS,
  SuggestedChangeSchema,
  type BuildStatus,
  type FlowFile,
  type ProviderId,
  type Suggestion,
} from "@flowcommit/shared";
import { z } from "zod";
import { GitError, git } from "./git.ts";
import { askInProject, extractJson, PROVIDERS } from "./ai.ts";
import { HttpError } from "./history.ts";
import type { Project } from "./project.ts";

/**
 * The code → design direction. When a step is built, FlowCommit remembers a fingerprint
 * (Git hash) of each file the agent changed. If one of those files later changes without a
 * build (someone edited it, or an agent worked without the FlowCommit tools), the step is
 * flagged, and an AI can read the change and suggest how the flow should be updated.
 */

const SAFE_FILE = /^(?!\/)(?!.*\.\.)[^\0]+$/;

/** Fingerprints the files and stores their contents in Git, so later changes can be shown as a diff. */
export async function fingerprint(project: Project, files: string[]): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {};
  for (const file of files.filter((f) => SAFE_FILE.test(f))) {
    try {
      hashes[file] = (await git(project.root, ["hash-object", "-w", "--", file])).trim();
    } catch {
      // A file that doesn't exist (yet) or isn't in a repository simply has no fingerprint.
    }
  }
  return hashes;
}

async function currentHash(project: Project, file: string): Promise<string | null> {
  try {
    return (await git(project.root, ["hash-object", "--", file])).trim();
  } catch {
    return null; // deleted
  }
}

export type Drift = { stepId: string; title: string; files: { file: string; deleted: boolean }[] };

/** Built steps whose code has changed since they were built. */
export async function findDrift(project: Project, flow: FlowFile, status: BuildStatus): Promise<Drift[]> {
  const drift: Drift[] = [];
  for (const node of flow.nodes) {
    const record = status.steps[node.id];
    if (record?.state !== "built") continue;
    const changed: Drift["files"] = [];
    for (const [file, hash] of Object.entries(record.fileHashes)) {
      const now = await currentHash(project, file);
      if (now !== hash) changed.push({ file, deleted: now === null });
    }
    if (changed.length) drift.push({ stepId: node.id, title: node.title, files: changed });
  }
  return drift;
}

/** What changed in a file since it was fingerprinted, as a unified diff. */
async function diffSince(project: Project, file: string, hash: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "flowcommit-diff-"));
  try {
    const before = path.join(dir, "before");
    await writeFile(before, await git(project.root, ["cat-file", "-p", hash]));
    const after = path.join(project.root, file);
    try {
      await git(project.root, ["diff", "--no-index", "--unified=3", "--", before, after]);
      return "";
    } catch (err) {
      // `git diff --no-index` exits with an error when the files differ; the diff is in its output.
      const out = err instanceof GitError ? err.stdout : "";
      return out || "(changed)";
    }
  } catch {
    return "(the earlier version of this file isn't available)";
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const MAX_DIFF_CHARS = 30_000;

const SYSTEM = `You keep a FlowCommit flowchart in step with an app's code. FlowCommit is where a person designs their app as a flowchart that AI agents build from. You never edit files. You read the code and reply with one JSON object of suggested flowchart changes, which the person will review.`;

function flowSummary(flow: FlowFile): string {
  const lines = flow.nodes.map(
    (n) => `- [${n.id}] ${n.kind}: ${n.title}${n.instructions ? ` — ${n.instructions.replace(/\s+/g, " ").slice(0, 300)}` : ""}`,
  );
  const arrows = flow.edges.map((e) => `- ${e.source} -> ${e.target}${e.label ? ` (${e.label})` : ""}`);
  return [`App: ${flow.name}`, flow.description, "", "Steps:", ...lines, "", "Arrows:", ...arrows].join("\n");
}

const FORMAT = `Reply with JSON in exactly this shape, and nothing else:
{"suggestions": [
  {"reason": "What the code does that the flowchart doesn't show, in one plain sentence",
   "files": ["path/in/project.ts"],
   "change": <one of:
     {"type": "add-step", "step": {"kind": "${NODE_KINDS.join('" | "')}", "title": "2-6 words", "instructions": "1-3 sentences"}, "after": "<step id it follows>", "before": "<step id it leads to, optional>", "label": "<arrow label, optional>"}
     {"type": "edit-step", "stepId": "<id>", "title": "<new title, optional>", "instructions": "<new instructions, optional>"}
     {"type": "remove-step", "stepId": "<id>"}
     {"type": "add-arrow", "from": "<id>", "to": "<id>", "label": "<optional>"}
     {"type": "remove-arrow", "from": "<id>", "to": "<id>"}>}
]}
Rules: only suggest changes the code clearly shows. Keep the person's wording where it's still right. Use existing step ids. If the flowchart already matches the code, reply {"suggestions": []}.`;

const ReplySchema = z.object({
  suggestions: z.array(
    z.object({ reason: z.string().default(""), files: z.array(z.string()).default([]), change: SuggestedChangeSchema }),
  ),
});

/**
 * Asks the person's AI tool to compare the code with the flow and suggest updates.
 * With drift, it looks at exactly what changed; without, it reads the whole project.
 */
export async function suggestFromCode(
  project: Project,
  provider: ProviderId,
  flow: FlowFile,
  status: BuildStatus,
  waiting: Suggestion[],
  signal?: AbortSignal,
): Promise<{ suggestions: Suggestion[]; reviewed: string[] }> {
  const drift = await findDrift(project, flow, status);
  let task: string;
  if (drift.length) {
    const parts: string[] = [];
    let size = 0;
    for (const d of drift) {
      for (const f of d.files) {
        const hash = status.steps[d.stepId].fileHashes[f.file];
        const diff = f.deleted ? "(file deleted)" : await diffSince(project, f.file, hash);
        if (size + diff.length > MAX_DIFF_CHARS) continue;
        size += diff.length;
        parts.push(`### ${f.file} (built for step [${d.stepId}] "${d.title}")\n${diff}`);
      }
    }
    task = `These code files changed after their steps were built, without going through the flowchart. Read the changes (and any other code you need) and suggest how the flowchart should change so it describes what the code now does.\n\n${parts.join("\n\n")}`;
  } else {
    task = `Read this project's code and compare it with the flowchart. Suggest changes so the flowchart describes what the code really does: screens, API endpoints, data and decisions that exist in the code but not in the flowchart, and steps the code doesn't have.`;
  }

  const already = waiting.length
    ? `\n\n## Suggestions already waiting for the person (don't repeat these)\n${waiting.map((w) => `- ${JSON.stringify(w.change)}`).join("\n")}`
    : "";
  const prompt = `${task}\n\n## The flowchart now\n${flowSummary(flow)}${already}\n\n${FORMAT}`;
  const reply = await askInProject(provider, SYSTEM, prompt, project.root, signal);
  const parsed = ReplySchema.safeParse(extractJson(reply));
  if (!parsed.success) throw new HttpError(502, "The AI's suggestions couldn't be read. Try again.");

  const ids = new Set(flow.nodes.map((n) => n.id));
  const label = PROVIDERS[provider].label;
  const now = new Date().toISOString();
  const taken = new Set(waiting.map((w) => target(w.change)));
  const suggestions = parsed.data.suggestions
    .filter((s) => {
      const c = s.change;
      const refs = c.type === "add-step" ? [c.after, c.before] : c.type === "edit-step" || c.type === "remove-step" ? [c.stepId] : [c.from, c.to];
      return refs.every((r) => !r || ids.has(r));
    })
    // One suggestion per thing: a second "edit Notes list" would only make the person compare two versions.
    .filter((s) => {
      const key = target(s.change);
      if (taken.has(key)) return false;
      taken.add(key);
      return true;
    })
    .map((s) => ({ ...s, id: nanoid(10), createdAt: now, source: label }));

  // The edited code has now been looked at, so stop flagging it; the suggestions carry it from here.
  const reviewed = drift.map((d) => d.stepId);
  for (const d of drift) await markReviewed(project, d.stepId);
  return { suggestions, reviewed };
}

/** What a suggestion is about, so two suggestions about the same thing can be told apart. */
function target(c: Suggestion["change"]): string {
  switch (c.type) {
    case "add-step":
      return `add:${c.step.title.trim().toLowerCase()}`;
    case "edit-step":
    case "remove-step":
      return `${c.type}:${c.stepId}`;
    default:
      return `${c.type}:${c.from}>${c.to}`;
  }
}

/** Accepts a built step's code as it is now: its files are fingerprinted again, so it's no longer flagged. */
export async function markReviewed(project: Project, stepId: string): Promise<void> {
  const status = await project.readStatus();
  const record = status.steps[stepId];
  if (!record) return;
  const hashes = await fingerprint(project, Object.keys(record.fileHashes));
  await project.updateStep(stepId, (current) => (current ? { ...current, fileHashes: { ...current.fileHashes, ...hashes } } : null));
}

/** After a step is built, its files are in step with the design again, for every step that uses them. */
export async function refreshFingerprints(project: Project, files: string[], hashes: Record<string, string>) {
  await project.updateStatus((status) => {
    for (const record of Object.values(status.steps)) {
      for (const file of files) if (file in record.fileHashes && hashes[file]) record.fileHashes[file] = hashes[file];
    }
  });
}
