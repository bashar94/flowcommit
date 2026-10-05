import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { HttpError } from "./history.ts";

/**
 * FlowCommit doesn't call any AI service itself. It borrows the AI command-line tool the user
 * already has installed and signed in to, so it uses their existing account and settings.
 */

export const PROVIDERS = {
  claude: { label: "Claude Code", command: "claude", install: "https://claude.com/claude-code" },
  codex: { label: "Codex CLI", command: "codex", install: "https://github.com/openai/codex" },
} as const;
export type ProviderId = keyof typeof PROVIDERS;

export type ProviderStatus = {
  id: ProviderId;
  label: string;
  available: boolean;
  version: string | null;
  install: string;
};

/** Quick jobs, like improving a text box or drafting a flow from a description. */
const TIMEOUT_MS = 5 * 60_000;
/** Reading a project's code, which takes much longer in a big project. */
const PROJECT_TIMEOUT_MS = 20 * 60_000;
const STATUS_TTL_MS = 30_000;

function capture(
  command: string,
  args: string[],
  opts: { input?: string; cwd?: string; signal?: AbortSignal; timeoutMs?: number } = {},
) {
  return new Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }>((resolve, reject) => {
    const child = spawn(command, args, { cwd: opts.cwd ?? os.tmpdir(), stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, opts.timeoutMs ?? TIMEOUT_MS);
    const abort = () => child.kill("SIGTERM");
    opts.signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", abort);
      resolve({ code, stdout, stderr, timedOut });
    });
    child.stdin.end(opts.input ?? "");
  });
}

let statusCache: { at: number; value: ProviderStatus[] } | null = null;

export async function providerStatus(): Promise<ProviderStatus[]> {
  if (statusCache && Date.now() - statusCache.at < STATUS_TTL_MS) return statusCache.value;
  const value = await Promise.all(
    (Object.keys(PROVIDERS) as ProviderId[]).map(async (id) => {
      const p = PROVIDERS[id];
      try {
        const { code, stdout } = await capture(p.command, ["--version"]);
        const version = stdout.trim().split("\n")[0] || null;
        return { id, label: p.label, available: code === 0, version, install: p.install };
      } catch {
        return { id, label: p.label, available: false, version: null, install: p.install };
      }
    }),
  );
  statusCache = { at: Date.now(), value };
  return value;
}

/** Sends one prompt to the chosen CLI with every tool turned off, and returns its reply text. */
export async function ask(provider: ProviderId, system: string, prompt: string, signal?: AbortSignal): Promise<string> {
  const status = (await providerStatus()).find((p) => p.id === provider);
  if (!status?.available) {
    throw new HttpError(409, `${PROVIDERS[provider]?.label ?? "That AI tool"} isn't installed on this computer.`);
  }

  if (provider === "claude") {
    const { code, stdout, stderr } = await capture(
      "claude",
      ["-p", "--tools", "", "--strict-mcp-config", "--no-session-persistence", "--output-format", "json", "--system-prompt", system],
      { input: prompt, signal },
    );
    if (signal?.aborted) throw new HttpError(499, "Cancelled.");
    let parsed: { result?: string; is_error?: boolean } = {};
    try {
      parsed = JSON.parse(stdout);
    } catch {
      // Fall through to the error below with whatever the CLI printed.
    }
    if (code !== 0 || parsed.is_error || typeof parsed.result !== "string") {
      throw new HttpError(502, cliError("Claude Code", parsed.result ?? stderr ?? stdout));
    }
    return parsed.result;
  }

  // Codex has no separate system prompt, so the instructions go first in the same message.
  const dir = await mkdtemp(path.join(os.tmpdir(), "flowcommit-codex-"));
  try {
    const out = path.join(dir, "reply.txt");
    const { code, stderr } = await capture(
      "codex",
      ["exec", "--skip-git-repo-check", "--sandbox", "read-only", "--ephemeral", "--color", "never", "-o", out, "-"],
      { input: `${system}\n\n---\n\n${prompt}`, cwd: dir, signal },
    );
    if (signal?.aborted) throw new HttpError(499, "Cancelled.");
    const reply = await readFile(out, "utf8").catch(() => "");
    if (code !== 0 || !reply.trim()) throw new HttpError(502, cliError("Codex", stderr));
    return reply;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Like `ask`, but the AI tool runs inside the project and may read (never change) its files.
 * Used to compare the code with the flowchart.
 */
const tookTooLong = (tool: string) =>
  new HttpError(
    504,
    `${tool} was still reading the code after ${PROJECT_TIMEOUT_MS / 60_000} minutes, so FlowCommit stopped it. In a very big project, map it a part at a time: open Sync and use "Add a part that's missing".`,
  );

export async function askInProject(
  provider: ProviderId,
  system: string,
  prompt: string,
  root: string,
  signal?: AbortSignal,
): Promise<string> {
  const status = (await providerStatus()).find((p) => p.id === provider);
  if (!status?.available) {
    throw new HttpError(409, `${PROVIDERS[provider]?.label ?? "That AI tool"} isn't installed on this computer.`);
  }
  if (provider === "claude") {
    const readOnly = ["Read", "Grep", "Glob"];
    const { code, stdout, stderr, timedOut } = await capture(
      "claude",
      [
        "-p",
        "--tools",
        readOnly.join(","),
        "--allowedTools",
        ...readOnly,
        "--strict-mcp-config",
        "--no-session-persistence",
        "--output-format",
        "json",
        "--append-system-prompt",
        system,
      ],
      { input: prompt, cwd: root, signal, timeoutMs: PROJECT_TIMEOUT_MS },
    );
    if (signal?.aborted) throw new HttpError(499, "Cancelled.");
    if (timedOut) throw tookTooLong("Claude Code");
    let parsed: { result?: string; is_error?: boolean } = {};
    try {
      parsed = JSON.parse(stdout);
    } catch {
      // Reported below.
    }
    if (code !== 0 || parsed.is_error || typeof parsed.result !== "string") {
      throw new HttpError(502, cliError("Claude Code", parsed.result ?? stderr ?? stdout));
    }
    return parsed.result;
  }
  const dir = await mkdtemp(path.join(os.tmpdir(), "flowcommit-codex-"));
  try {
    const out = path.join(dir, "reply.txt");
    const { code, stderr, timedOut } = await capture(
      "codex",
      ["exec", "--skip-git-repo-check", "--sandbox", "read-only", "--ephemeral", "--color", "never", "-C", root, "-o", out, "-"],
      { input: `${system}\n\n---\n\n${prompt}`, cwd: root, signal, timeoutMs: PROJECT_TIMEOUT_MS },
    );
    if (signal?.aborted) throw new HttpError(499, "Cancelled.");
    if (timedOut) throw tookTooLong("Codex");
    const reply = await readFile(out, "utf8").catch(() => "");
    if (code !== 0 || !reply.trim()) throw new HttpError(502, cliError("Codex", stderr));
    return reply;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function cliError(label: string, output: string): string {
  const text = output.trim();
  if (/log ?in|auth|credential|api key|unauthori/i.test(text)) {
    return `${label} needs you to sign in. Run it once in your terminal to sign in, then try again.`;
  }
  const lastLine = text.split("\n").filter(Boolean).pop()?.slice(0, 200);
  return lastLine ? `${label} couldn't finish: ${lastLine}` : `${label} didn't reply. Try again.`;
}

/** Removes wrappers that models sometimes add around a plain-text answer. */
export function cleanText(text: string): string {
  let t = text.trim();
  const fence = t.match(/^```[a-z]*\n([\s\S]*?)\n```$/i);
  if (fence) t = fence[1].trim();
  if (/^".*"$/s.test(t) && !t.slice(1, -1).includes('"')) t = t.slice(1, -1);
  return t;
}

/** Pulls the JSON object out of a reply, even if the model wrapped it in prose or a code fence. */
export function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new HttpError(502, "The AI reply didn't contain a flowchart. Try again.");
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new HttpError(502, "The AI reply wasn't a valid flowchart. Try again.");
  }
}
