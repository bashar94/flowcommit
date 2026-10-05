/**
 * Runs the secret check over what's about to leave the computer (commits about to be pushed)
 * or about to be stored for good (changes about to be saved as a version).
 */
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  FLOW_DIR,
  FLOW_FILE,
  diffFlows,
  riskyFile,
  scanLines,
  scanText,
  skipPath,
  type FlowFile,
  type RiskyFile,
  type SecretFinding,
  type SecretReport,
} from "@flowcommit/shared";
import { git } from "./git.ts";

const FLOW_PATH = `${FLOW_DIR}/${FLOW_FILE}`;
const MAX_FILE = 1024 * 1024;

type Added = Map<string, { line: number; text: string }[]>;

/** Reads `git diff` or `git log -p` output (made with -U0) and collects each file's added lines. */
function addedLines(patch: string, added: Added = new Map()): Added {
  let file: string | null = null;
  let line = 0;
  for (const raw of patch.split("\n")) {
    if (raw.startsWith("diff --git ")) {
      file = null;
    } else if (raw.startsWith("+++ ")) {
      const target = raw.slice(4);
      file = target === "/dev/null" ? null : target.replace(/^b\//, "");
    } else if (raw.startsWith("@@")) {
      line = Number(/\+(\d+)/.exec(raw)?.[1] ?? 0);
    } else if (file && raw.startsWith("+")) {
      const list = added.get(file) ?? [];
      list.push({ line, text: raw.slice(1) });
      added.set(file, list);
      line++;
    }
  }
  return added;
}

function report(added: Added, extraFiles: string[] = []): SecretReport {
  const findings: SecretFinding[] = [];
  for (const [file, lines] of added) {
    if (file === FLOW_PATH) continue; // the design is checked step by step instead
    findings.push(...scanLines(file, lines));
  }
  const files: RiskyFile[] = [];
  for (const file of new Set([...added.keys(), ...extraFiles])) {
    const reason = riskyFile(file);
    if (reason) files.push({ file, reason });
  }
  return { findings, files };
}

/** Secrets in the design's own text: titles, instructions, captions and links. */
function scanFlow(flow: FlowFile, before: FlowFile | null): SecretFinding[] {
  const diff = diffFlows(before, flow);
  const touched = new Set(diff.nodes.filter((n) => n.status === "added" || n.status === "changed").map((n) => n.id));
  const out: SecretFinding[] = [];
  for (const node of flow.nodes) {
    if (!touched.has(node.id)) continue;
    const text = [
      node.title,
      node.instructions,
      node.codeRef ?? "",
      ...(node.rules ?? []),
      ...node.attachments.flatMap((a) => [a.caption, a.kind === "link" ? a.src : "", ...a.annotations.map((m) => m.note)]),
    ].join("\n");
    for (const f of scanText(FLOW_PATH, text)) out.push({ ...f, step: { id: node.id, title: node.title || "Untitled step" } });
  }
  if (diff.meta.description) {
    out.push(...scanText(FLOW_PATH, flow.description).map((f) => ({ ...f, step: { id: "", title: "What are you building?" } })));
  }
  return out;
}

/** Everything in commits that would be pushed: every commit not yet on any remote. */
export async function scanUnpushed(root: string): Promise<SecretReport & { commits: number }> {
  const head = await git(root, ["rev-parse", "-q", "--verify", "HEAD"]).catch(() => "");
  if (!head.trim()) return { findings: [], files: [], commits: 0 };
  const range = ["HEAD", "--not", "--remotes"];
  const count = Number((await git(root, ["rev-list", "--count", ...range])).trim()) || 0;
  if (!count) return { findings: [], files: [], commits: 0 };
  const patch = await git(root, ["log", "-p", "-U0", "--no-color", "--no-ext-diff", "--format=", "--relative", ...range, "--", "."]);
  const added = addedLines(patch);
  const result = report(added);
  // The design file is checked as text too, since its JSON lines map back to step text.
  const flowLines = added.get(FLOW_PATH);
  if (flowLines) result.findings.push(...scanLines(FLOW_PATH, flowLines));
  return { ...result, commits: count };
}

/** Changes about to be saved as a version: the design, and the code files if they're included. */
export async function scanChanges(
  root: string,
  opts: { codeFiles: string[]; flow: FlowFile; savedFlow: FlowFile | null },
): Promise<SecretReport> {
  const files = opts.codeFiles.filter((f) => !skipPath(f));
  const added: Added = new Map();
  if (files.length) {
    const hasHead = !!(await git(root, ["rev-parse", "-q", "--verify", "HEAD"]).catch(() => "")).trim();
    const untracked = new Set(
      (await git(root, ["ls-files", "-z", "--others", "--exclude-standard", "--", "."])).split("\0").filter(Boolean),
    );
    const tracked = files.filter((f) => hasHead && !untracked.has(f));
    if (tracked.length) {
      addedLines(await git(root, ["diff", "HEAD", "-U0", "--no-color", "--no-ext-diff", "--relative", "--", ...tracked]), added);
    }
    // New files have no diff yet, so read them whole.
    for (const f of files.filter((f) => !tracked.includes(f))) {
      const full = path.join(root, f);
      const info = await stat(full).catch(() => null);
      if (!info?.isFile() || info.size > MAX_FILE) continue;
      const buf = await readFile(full);
      if (buf.includes(0)) continue; // binary
      added.set(
        f,
        buf
          .toString("utf8")
          .split("\n")
          .map((text, i) => ({ line: i + 1, text })),
      );
    }
  }
  const existing: string[] = [];
  for (const f of files) if (await stat(path.join(root, f)).then(() => true, () => false)) existing.push(f);
  const result = report(added, existing);
  result.findings.push(...scanFlow(opts.flow, opts.savedFlow));
  return result;
}
