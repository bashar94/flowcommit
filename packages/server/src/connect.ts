import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Project } from "./project.ts";

/**
 * The command that runs one of FlowCommit's scripts (mcp or hook), as [program, ...args].
 * - Run through npx, FlowCommit lives in npm's cache, which can be cleared or replaced by a
 *   newer version, so AI tools are told to start it through npx too.
 * - Installed (npm install -g or npm link), it runs its bundled JavaScript with Node.
 * - From a copy of the source, it runs the TypeScript through tsx.
 */
function scriptLaunch(name: "mcp" | "hook"): string[] {
  if (import.meta.filename.endsWith(".js")) {
    if (import.meta.dirname.split(path.sep).includes("_npx")) return ["npx", "-y", "flowcommit", name];
    return [process.execPath, path.join(import.meta.dirname, `${name}.js`)];
  }
  return [process.execPath, fileURLToPath(import.meta.resolve("tsx/cli")), path.join(import.meta.dirname, `${name}.ts`)];
}

/** How an AI CLI should start FlowCommit's MCP server for this project. */
export function mcpLaunch(project: Project) {
  const [command, ...args] = scriptLaunch("mcp");
  return { command, args: [...args, "--project", project.root] };
}

const quote = (s: string) => (/^[\w./:@-]+$/.test(s) ? s : `'${s.replaceAll("'", `'\\''`)}'`);

/** Terminal commands that register the server with each CLI, for people who prefer to run them. */
export function connectCommands(project: Project) {
  const { command, args } = mcpLaunch(project);
  const launch = [command, ...args].map(quote).join(" ");
  return {
    claude: `claude mcp add flowcommit --scope project -- ${launch}`,
    codex: `codex mcp add flowcommit -- ${launch}`,
  };
}

const mcpConfigPath = (project: Project) => path.join(project.root, ".mcp.json");

type McpConfig = { mcpServers?: Record<string, unknown> } & Record<string, unknown>;

async function readMcpConfig(project: Project): Promise<McpConfig | null> {
  try {
    return JSON.parse(await readFile(mcpConfigPath(project), "utf8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    return null; // exists but isn't valid JSON; leave it alone
  }
}

export async function isClaudeConnected(project: Project): Promise<boolean> {
  const config = await readMcpConfig(project);
  return !!config?.mcpServers && "flowcommit" in config.mcpServers;
}

/**
 * Adds FlowCommit to the project's `.mcp.json`, which Claude Code reads when it starts in this
 * folder. Other servers in the file are kept. Claude Code asks the person to approve it once.
 */
export async function connectClaude(project: Project): Promise<void> {
  const config = await readMcpConfig(project);
  if (config === null) throw new Error("This project's .mcp.json isn't valid JSON, so FlowCommit left it alone. Fix it, then try again.");
  const next = { ...config, mcpServers: { ...(config.mcpServers ?? {}), flowcommit: { type: "stdio", ...mcpLaunch(project) } } };
  await writeFile(mcpConfigPath(project), JSON.stringify(next, null, 2) + "\n", "utf8");
}

// ----- Telling the agent about design changes automatically -----

const HOOK_MARKER = "flowcommit-hook";

/** The shell command Claude Code runs before each message. Paths are quoted because they can contain spaces. */
function hookCommand(): string {
  const q = (s: string) => `"${s.replaceAll('"', '\\"')}"`;
  return `${scriptLaunch("hook").map(q).join(" ")} --project "$CLAUDE_PROJECT_DIR" # ${HOOK_MARKER}`;
}

const claudeSettingsPath = (project: Project) => path.join(project.root, ".claude", "settings.json");

type HookEntry = { hooks?: { type?: string; command?: string; timeout?: number }[] };
type ClaudeSettings = { hooks?: Record<string, HookEntry[]> } & Record<string, unknown>;

async function readClaudeSettings(project: Project): Promise<ClaudeSettings | null> {
  try {
    return JSON.parse(await readFile(claudeSettingsPath(project), "utf8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    return null;
  }
}

export async function hasClaudeHook(project: Project): Promise<boolean> {
  const settings = await readClaudeSettings(project);
  return !!settings?.hooks?.UserPromptSubmit?.some((e) => e.hooks?.some((h) => h.command?.includes(HOOK_MARKER)));
}

/**
 * Adds a Claude Code hook to the project's `.claude/settings.json` that tells Claude, at the start
 * of each message, what changed in the design. Existing settings and hooks are kept, and an old
 * FlowCommit hook is replaced rather than duplicated. Claude Code asks the person to trust it once.
 */
export async function addClaudeHook(project: Project): Promise<void> {
  const settings = await readClaudeSettings(project);
  if (settings === null) {
    throw new Error("This project's .claude/settings.json isn't valid JSON, so FlowCommit left it alone. Fix it, then try again.");
  }
  const hooks = { ...(settings.hooks ?? {}) };
  const others = (hooks.UserPromptSubmit ?? [])
    .map((e) => ({ ...e, hooks: (e.hooks ?? []).filter((h) => !h.command?.includes(HOOK_MARKER)) }))
    .filter((e) => e.hooks.length);
  hooks.UserPromptSubmit = [...others, { hooks: [{ type: "command", command: hookCommand(), timeout: 10 }] }];
  await mkdir(path.dirname(claudeSettingsPath(project)), { recursive: true });
  await writeFile(claudeSettingsPath(project), JSON.stringify({ ...settings, hooks }, null, 2) + "\n", "utf8");
}

const AGENTS_START = "<!-- flowcommit:start -->";
const AGENTS_END = "<!-- flowcommit:end -->";
const AGENTS_SECTION = `${AGENTS_START}
## FlowCommit

This app's design lives in a FlowCommit flowchart (\`.flowcommit/\`). Keep the code and the flowchart in step, using the \`flowcommit\` MCP tools:

- At the start of every task, call \`get_design_changes\`. Build what's new, rebuild what was edited (\`next_step\`, \`start_step\`, \`finish_step\` with every file you changed), and remove the code of deleted steps (\`confirm_removed\`).
- Whenever you build or change something the flowchart doesn't show, or the code works differently from a step's instructions, call \`suggest_flow_change\`. This includes changes the person asks for directly in chat.
- Never edit \`.flowcommit/\` yourself; the person edits the design in FlowCommit.
${AGENTS_END}
`;

/** Codex, Cursor and other agents read AGENTS.md. FlowCommit keeps its own section in it, between markers. */
export async function hasAgentsInstructions(project: Project): Promise<boolean> {
  const text = await readFile(path.join(project.root, "AGENTS.md"), "utf8").catch(() => "");
  return text.includes(AGENTS_START);
}

export async function addAgentsInstructions(project: Project): Promise<void> {
  const file = path.join(project.root, "AGENTS.md");
  const text = await readFile(file, "utf8").catch(() => "");
  const start = text.indexOf(AGENTS_START);
  const end = text.indexOf(AGENTS_END);
  const next =
    start !== -1 && end > start
      ? text.slice(0, start) + AGENTS_SECTION.trimEnd() + text.slice(end + AGENTS_END.length)
      : `${text}${text && !text.endsWith("\n\n") ? (text.endsWith("\n") ? "\n" : "\n\n") : ""}${AGENTS_SECTION}`;
  await writeFile(file, next, "utf8");
}
