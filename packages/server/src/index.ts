import express, { type ErrorRequestHandler } from "express";
import path from "node:path";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, watch, type FSWatcher } from "node:fs";
import { mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { ZodError, z } from "zod";
import {
  DraftFlowSchema,
  DraftRequestSchema,
  ImportedFlowSchema,
  ImportedPartSchema,
  FLOW_DIR,
  FLOW_FILE,
  PROVIDER_IDS,
  STATUS_FILE,
  SUGGESTIONS_FILE,
  StepSpecSchema,
  WriteRequestSchema,
  pendingChanges,
  parseFlow,
  hasSecrets,
  FLOWCOMMIT_VERSION,
} from "@flowcommit/shared";
import { Project } from "./project.ts";
import { History, HttpError } from "./history.ts";
import { git } from "./git.ts";
import { ask, askInProject, cleanText, extractJson, providerStatus } from "./ai.ts";
import { DRAFT_SYSTEM, IMPORT_SYSTEM, WRITE_SYSTEM, draftPrompt, importPartPrompt, importPrompt, writePrompt } from "./prompts.ts";
import {
  addAgentsInstructions,
  addClaudeHook,
  connectClaude,
  connectCommands,
  hasAgentsInstructions,
  hasClaudeHook,
  isClaudeConnected,
} from "./connect.ts";
import { findDrift, fingerprint, markReviewed, suggestFromCode } from "./codeSync.ts";
import { Repo } from "./repo.ts";
import { scanChanges, scanUnpushed } from "./secretScan.ts";
import { buildRunner, emit, getTemplate, listTemplates, loadPlugins, registry, shareTarget } from "./plugins.ts";
import {
  checkProjectFolder,
  createProjectFolder,
  forgetProject,
  listFolders,
  recentProjects,
  rememberProject,
} from "./projects.ts";

const PORT = Number(process.env.FLOWCOMMIT_PORT ?? 4318);
const MAX_UPLOAD = "50mb";
const ALLOWED_UPLOAD = /^(image|video)\//;

const demoRoot = path.resolve(import.meta.dirname, "../../../demo-project");
const projectRoot = path.resolve(process.env.FLOWCOMMIT_PROJECT ?? demoRoot);

// The open project. Opening another one from the app swaps all three (see openProject below).
let project = new Project(projectRoot);
let history = new History(project);
let repo = new Repo(project, history);

// The demo folder sits inside the FlowCommit repo, which ignores it, so it gets its own repository.
if (project.root === demoRoot && !existsSync(path.join(demoRoot, ".git"))) {
  mkdirSync(demoRoot, { recursive: true });
  await git(demoRoot, ["init", "-q"]);
}

const app = express();

/**
 * FlowCommit only answers requests meant for this computer, from pages on this computer.
 * - The Host check stops DNS rebinding, where a website points its own domain at 127.0.0.1
 *   to reach local servers.
 * - The Origin check stops other websites from sending requests from a visitor's browser.
 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
app.use((req, res, next) => {
  const host = (req.headers.host ?? "").replace(/:\d+$/, "");
  let local = LOCAL_HOSTS.has(host);
  const origin = req.headers.origin;
  if (local && origin) {
    try {
      local = LOCAL_HOSTS.has(new URL(origin).hostname);
    } catch {
      local = false;
    }
  }
  if (!local) {
    res.status(403).json({ error: "FlowCommit only answers requests from this computer." });
    return;
  }
  next();
});

app.use(express.json({ limit: "5mb" }));

/**
 * Pages say which project they're showing. After another project is opened, a page that hasn't
 * reloaded yet can't save its old flow into the new project.
 */
const PROJECT_HEADER = "x-flowcommit-project";
app.use("/api", (req, res, next) => {
  res.setHeader(PROJECT_HEADER, encodeURIComponent(project.root));
  const claimed = req.headers[PROJECT_HEADER];
  if (req.method !== "GET" && typeof claimed === "string" && !req.path.startsWith("/projects")) {
    if (decodeURIComponent(claimed) !== project.root) {
      res.status(409).json({ error: "FlowCommit switched to another project. Reload this page." });
      return;
    }
  }
  next();
});

/** Files FlowCommit or AI tools add, which don't make a folder count as having code. */
const NOT_CODE = new Set([FLOW_DIR, ".git", ".mcp.json", ".claude", "AGENTS.md", ".DS_Store", ".gitignore"]);

app.get("/api/project", async (_req, res) => {
  const entries = await readdir(project.root).catch(() => [] as string[]);
  res.json({ name: project.name, path: project.root, hasCode: entries.some((e) => !NOT_CODE.has(e)) });
});

app.get("/api/projects", async (_req, res) => {
  const recent = await recentProjects();
  res.json({ current: { name: project.name, path: project.root }, recent: recent.filter((p) => p.path !== project.root) });
});

app.get("/api/folders", async (req, res) => {
  res.json(await listFolders(typeof req.query.path === "string" ? req.query.path : undefined));
});

app.post("/api/projects/open", async (req, res) => {
  const root = await checkProjectFolder(String(req.body?.path ?? ""));
  await openProject(root);
  res.json({ name: project.name, path: project.root });
});

/** A new project is a new folder with Git turned on, so every version is kept from the start. */
app.post("/api/projects/create", async (req, res) => {
  const root = await createProjectFolder(String(req.body?.parent ?? ""), String(req.body?.name ?? ""));
  try {
    await git(root, ["init", "-q"]);
  } catch {
    // Without Git the project still opens; History offers to turn it on.
  }
  await openProject(root);
  res.json({ name: project.name, path: project.root });
});

app.delete("/api/projects/recent", async (req, res) => {
  await forgetProject(String(req.body?.path ?? ""));
  res.json({ recent: (await recentProjects()).filter((p) => p.path !== project.root) });
});

app.get("/api/flow", async (_req, res) => {
  res.json(await project.readFlow());
});

app.put("/api/flow", async (req, res) => {
  let flow;
  try {
    flow = parseFlow(req.body);
  } catch (err) {
    if (err instanceof ZodError) throw err;
    res.status(400).json({ error: (err as Error).message });
    return;
  }
  await project.writeFlow(flow);
  res.json({ ok: true });
  emit("flowSaved", { project: projectInfo(), flow });
});

app.post(
  "/api/assets",
  express.raw({ type: () => true, limit: MAX_UPLOAD }),
  async (req, res) => {
    const name = String(req.query.name ?? "");
    const type = req.headers["content-type"] ?? "";
    if (!name || !ALLOWED_UPLOAD.test(type)) {
      res.status(400).json({ error: "Only image and video files can be attached." });
      return;
    }
    const src = await project.saveAsset(name, req.body as Buffer);
    res.json({ src, kind: type.startsWith("video/") ? "video" : "image" });
  },
);

app.get("/api/history", async (_req, res) => {
  res.json({ state: await history.state(), versions: await history.list() });
});

app.post("/api/history/init", async (_req, res) => {
  await history.init();
  await watchGit();
  res.json({ state: await history.state() });
});

// ----- Branches, the commit graph and GitHub -----

app.get("/api/graph", async (_req, res) => {
  res.json(await repo.graph());
});

app.get("/api/git/merge-base", async (req, res) => {
  res.json({ sha: await repo.mergeBase(String(req.query.a ?? ""), String(req.query.b ?? "")) });
});

app.post("/api/git/switch", async (req, res) => {
  await repo.switchBranch(String(req.body?.branch ?? ""));
  res.json({ ok: true });
});

app.post("/api/git/branch", async (req, res) => {
  await repo.createBranch(String(req.body?.name ?? ""));
  res.json({ ok: true });
});

app.post("/api/git/fetch", async (_req, res) => {
  await repo.fetch();
  res.json({ ok: true });
});

app.post("/api/git/pull", async (_req, res) => {
  await repo.pull();
  res.json({ ok: true });
});

/**
 * Pushing checks every commit that isn't on GitHub yet for passwords and keys first. Once pushed,
 * a secret stays in the history for anyone to see, so the person decides with the facts in front
 * of them.
 */
app.post("/api/git/push", async (req, res) => {
  if (req.body?.allowSecrets !== true) {
    const found = await scanUnpushed(project.root);
    if (hasSecrets(found)) {
      res.status(409).json({ error: "These commits look like they contain passwords or keys.", secrets: found });
      return;
    }
  }
  await repo.push();
  res.json({ ok: true });
  const branch = (await git(project.root, ["symbolic-ref", "--short", "-q", "HEAD"]).catch(() => "")).trim() || null;
  emit("pushed", { project: projectInfo(), branch });
});

app.get("/api/github/prs", async (_req, res) => {
  res.json(await repo.pullRequests());
});

app.post("/api/github/prs/:number/fetch", async (req, res) => {
  res.json(await repo.fetchPullRequest(Number(req.params.number), String(req.body?.base ?? "main")));
});

app.post("/api/versions", async (req, res) => {
  const withCode = req.body?.withCode === true;
  const exclude = new Set<string>((Array.isArray(req.body?.exclude) ? req.body.exclude : []).map(String));
  const codeFiles = withCode ? (await history.codeChanges()).filter((f) => !exclude.has(f)) : [];
  // Check what's about to be stored for good. The person can still save it anyway.
  if (req.body?.allowSecrets !== true) {
    const savedFlow = await history.headFlow().catch(() => null);
    const found = await scanChanges(project.root, { codeFiles, flow: await project.readFlow(), savedFlow });
    if (hasSecrets(found)) {
      res.status(409).json({ error: "This version looks like it contains passwords or keys.", secrets: found });
      return;
    }
  }
  const message = String(req.body?.message ?? "");
  const version = await history.save(message, { withCode, files: withCode ? codeFiles : undefined });
  res.json(version);
  emit("versionSaved", { project: projectInfo(), sha: version.sha, message: version.message, withCode });
});

/** Keeps a file out of Git from now on (it stays on disk), for files like `.env`. */
app.post("/api/secrets/ignore", async (req, res) => {
  const file = String(req.body?.file ?? "").replace(/^\.\//, "");
  const full = path.resolve(project.root, file);
  if (!file || path.relative(project.root, full).startsWith("..") || path.isAbsolute(path.relative(project.root, full))) {
    throw new HttpError(400, "That file isn't in this project.");
  }
  const gitignore = path.join(project.root, ".gitignore");
  const current = await readFile(gitignore, "utf8").catch(() => "");
  if (!current.split("\n").some((l) => l.trim() === file)) {
    await writeFile(gitignore, `${current}${current && !current.endsWith("\n") ? "\n" : ""}${file}\n`);
  }
  // If Git already tracks it, stop tracking it without deleting the file.
  await git(project.root, ["rm", "--cached", "-q", "--ignore-unmatch", "--", file]).catch(() => {});
  res.json({ ok: true });
});

app.get("/api/versions/code-changes", async (_req, res) => {
  res.json({ files: await history.codeChanges() });
});

app.get("/api/versions/:sha/code", async (req, res) => {
  res.json({ files: await history.codeAt(req.params.sha) });
});

/**
 * Opens a version as a new branch: the design and the code go back to that commit, and new
 * work continues from there. Unsaved work would be carried along or block the switch, so
 * it has to be saved first.
 */
app.post("/api/versions/:sha/branch", async (req, res) => {
  const [code, design] = await Promise.all([
    history.codeChanges(),
    git(project.root, ["status", "--porcelain", "--", `./${FLOW_DIR}`]),
  ]);
  if (code.length || design.trim()) {
    throw new HttpError(
      409,
      "Save a version first, including your code changes, so nothing is left behind when the design and code switch.",
    );
  }
  await repo.createBranch(String(req.body?.name ?? ""), req.params.sha);
  res.json({ ok: true });
});

app.get("/api/versions/:sha/flow", async (req, res) => {
  const flow = await history.flowAt(req.params.sha);
  if (!flow) throw new HttpError(404, "That version couldn't be read.");
  res.json(flow);
});

app.get("/api/versions/:sha/assets/:file", async (req, res) => {
  const data = await history.assetAt(req.params.sha, req.params.file);
  res.type(path.extname(req.params.file)).set("Cache-Control", "public, max-age=31536000, immutable").send(data);
});

app.post("/api/versions/:sha/restore", async (req, res) => {
  res.json(await history.restore(req.params.sha));
});

/** Stops the AI tool when the browser gives up on the request, for example when the user cancels. */
function abortOnClose(res: express.Response): AbortSignal {
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });
  return controller.signal;
}

app.get("/api/ai", async (_req, res) => {
  res.json({ providers: await providerStatus() });
});

app.post("/api/ai/write", async (req, res) => {
  const body = WriteRequestSchema.parse(req.body);
  if (body.action === "custom" && !body.instruction.trim()) {
    throw new HttpError(400, "Say what you want the AI to change.");
  }
  const reply = await ask(body.provider, WRITE_SYSTEM, writePrompt(body), abortOnClose(res));
  res.json({ text: cleanText(reply) });
});

app.post("/api/ai/draft", async (req, res) => {
  const body = DraftRequestSchema.parse(req.body);
  const reply = await ask(body.provider, DRAFT_SYSTEM, draftPrompt(body.description), abortOnClose(res));
  const parsed = DraftFlowSchema.safeParse(extractJson(reply));
  if (!parsed.success) throw new HttpError(502, "The AI drafted a flowchart FlowCommit couldn't read. Try again.");
  const ids = new Set(parsed.data.steps.map((s) => s.id));
  const arrows = parsed.data.arrows.filter((a) => ids.has(a.from) && ids.has(a.to) && a.from !== a.to);
  res.json({ ...parsed.data, arrows });
});

/** Reads the project's code (without changing it) and draws the flow it finds. */
app.post("/api/ai/import", async (req, res) => {
  const provider = z.enum(PROVIDER_IDS).parse(req.body?.provider);
  const reply = await askInProject(provider, IMPORT_SYSTEM, importPrompt(), project.root, abortOnClose(res));
  const parsed = ImportedFlowSchema.safeParse(extractJson(reply));
  if (!parsed.success) throw new HttpError(502, "The AI drew a flowchart FlowCommit couldn't read. Try again.");
  const ids = new Set(parsed.data.steps.map((s) => s.id));
  const partIds = new Set(parsed.data.parts.map((p) => p.id));
  const steps = await Promise.all(
    parsed.data.steps.map(async (s) => ({
      ...s,
      part: partIds.has(s.part) ? s.part : "",
      files: await existingFiles(s.files),
    })),
  );
  const arrows = parsed.data.arrows.filter((a) => ids.has(a.from) && ids.has(a.to) && a.from !== a.to);
  // A part with no steps isn't worth a group.
  const parts = parsed.data.parts.filter((p) => steps.some((s) => s.part === p.id));
  res.json({ ...parsed.data, parts, steps, arrows });
});

/** Reads one part of the app (like "the AI chatbot") and draws it, to add to the current flow. */
app.post("/api/ai/import-part", async (req, res) => {
  const provider = z.enum(PROVIDER_IDS).parse(req.body?.provider);
  const part = String(req.body?.part ?? "").trim().slice(0, 500);
  if (!part) throw new HttpError(400, "Say which part of the app to draw, like \"the AI chatbot\".");
  const flow = await project.readFlow();
  const existing = flow.nodes.map((n) => ({ id: n.id, title: n.title, codeRef: n.codeRef }));
  const reply = await askInProject(provider, IMPORT_SYSTEM, importPartPrompt(part, existing), project.root, abortOnClose(res));
  const parsed = ImportedPartSchema.safeParse(extractJson(reply));
  if (!parsed.success) throw new HttpError(502, "The AI drew that part in a way FlowCommit couldn't read. Try again.");
  // New ids must not clash with steps already in the flow.
  const taken = new Set(flow.nodes.map((n) => n.id));
  const fresh = parsed.data.steps.filter((s) => !taken.has(s.id));
  const ids = new Set(fresh.map((s) => s.id));
  const steps = await Promise.all(fresh.map(async (s) => ({ ...s, files: await existingFiles(s.files) })));
  const arrows = parsed.data.arrows.filter((a) => ids.has(a.from) && ids.has(a.to) && a.from !== a.to);
  const connect = parsed.data.connect.filter(
    (c) => (taken.has(c.from) && ids.has(c.to)) || (ids.has(c.from) && taken.has(c.to)),
  );
  if (!steps.length) throw new HttpError(502, "The AI didn't find new steps for that part. Try describing it differently.");
  res.json({ ...parsed.data, steps, arrows, connect });
});

/** Keeps the paths that are real files inside the project, written relative to it. */
async function existingFiles(files: string[]): Promise<string[]> {
  const found: string[] = [];
  for (const f of files) {
    const full = path.resolve(project.root, f);
    const rel = path.relative(project.root, full);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) continue;
    if (await stat(full).then((st) => st.isFile(), () => false)) found.push(rel.split(path.sep).join("/"));
  }
  return [...new Set(found)].slice(0, 8);
}

/** Opens one of the project's files in this computer's default app for it. */
app.post("/api/open-file", async (req, res) => {
  const [file] = await existingFiles([String(req.body?.file ?? "")]);
  // Follow links too: a link inside the project mustn't open something outside it.
  const [real, root] = await Promise.all([realpath(path.join(project.root, file ?? "")).catch(() => ""), realpath(project.root)]);
  if (!file || !real.startsWith(root + path.sep)) throw new HttpError(404, "That file isn't in this project.");
  openWithSystem(real);
  res.json({ ok: true });
});

// ----- Plugins -----

const projectInfo = () => ({ name: project.name, root: project.root });

const ShareResultSchema = z.object({ message: z.string(), url: z.string().url().optional() });

app.get("/api/plugins", (_req, res) => {
  res.json(registry.info());
});

app.get("/api/templates", async (_req, res) => {
  res.json({ sources: await listTemplates() });
});

app.get("/api/templates/:source/:id", async (req, res) => {
  res.json(await getTemplate(req.params.source, req.params.id));
});

app.post("/api/share/:target", async (req, res) => {
  const result = await shareTarget(req.params.target)({ project: projectInfo(), flow: await project.readFlow() });
  const parsed = ShareResultSchema.safeParse(result);
  if (!parsed.success) throw new HttpError(502, "The sharing plugin answered with something FlowCommit couldn't read.");
  res.json(parsed.data);
});

app.post("/api/runners/:id/start", async (req, res) => {
  const result = await buildRunner(req.params.id)({ project: projectInfo(), flow: await project.readFlow() });
  const parsed = ShareResultSchema.safeParse(result);
  if (!parsed.success) throw new HttpError(502, "The builder plugin answered with something FlowCommit couldn't read.");
  res.json(parsed.data);
});

// ----- Building with an AI agent -----

app.get("/api/build", async (_req, res) => {
  res.json({
    status: await project.readStatus(),
    claudeConnected: await isClaudeConnected(project),
    claudeHook: await hasClaudeHook(project),
    agentsInstructions: await hasAgentsInstructions(project),
    commands: connectCommands(project),
    projectPath: project.root,
  });
});

app.post("/api/build/reset", async (req, res) => {
  const stepId = String(req.body?.stepId ?? "");
  if (!stepId) throw new HttpError(400, "Say which step to reset.");
  res.json({ status: await project.updateStep(stepId, () => null) });
});

app.post("/api/connect/claude", async (req, res) => {
  await connectClaude(project);
  if (req.body?.hook !== false) await addClaudeHook(project);
  res.json({ claudeConnected: true });
});

app.post("/api/connect/agents", async (_req, res) => {
  await addAgentsInstructions(project);
  res.json({ agentsInstructions: true });
});

// ----- Keeping the design and the code in step -----

app.get("/api/sync", async (_req, res) => {
  const [flow, status, suggestions] = await Promise.all([project.readFlow(), project.readStatus(), project.readSuggestions()]);
  const pending = pendingChanges(flow, status);
  res.json({
    suggestions: suggestions.suggestions,
    drift: await findDrift(project, flow, status),
    removed: pending.removed,
  });
});

app.delete("/api/sync/suggestions/:id", async (req, res) => {
  res.json(await project.removeSuggestion(req.params.id));
});

app.post("/api/sync/analyze", async (req, res) => {
  const provider = String(req.body?.provider ?? "");
  if (!(PROVIDER_IDS as readonly string[]).includes(provider)) throw new HttpError(400, "Choose Claude Code or Codex.");
  const [flow, status, waiting] = await Promise.all([project.readFlow(), project.readStatus(), project.readSuggestions()]);
  const found = await suggestFromCode(
    project,
    provider as (typeof PROVIDER_IDS)[number],
    flow,
    status,
    waiting.suggestions,
    abortOnClose(res),
  );
  if (found.suggestions.length) await project.addSuggestions(found.suggestions);
  res.json({ added: found.suggestions.length, reviewed: found.reviewed.length });
});

/**
 * A suggestion the person accepted came from the code, so the code already does it. The step is
 * recorded as built with its new design, instead of being sent back to the AI to build again.
 */
/**
 * Steps drawn from code that already exists count as built, so the build only covers what's
 * new, and later edits to that code are noticed. Sending `remove` forgets steps again (undo).
 */
app.post("/api/build/imported", async (req, res) => {
  const body = z
    .object({
      steps: z.array(z.object({ stepId: z.string(), spec: StepSpecSchema, files: z.array(z.string()) })).default([]),
      remove: z.array(z.string()).default([]),
      source: z.string().default(""),
    })
    .parse(req.body);
  for (const id of body.remove) await project.updateStep(id, () => null);
  for (const step of body.steps) {
    const files = await existingFiles(step.files);
    const fileHashes = await fingerprint(project, files);
    await project.updateStep(step.stepId, () => ({
      state: "built",
      note: "Already in the code when the flow was drawn.",
      files,
      fileHashes,
      agent: body.source,
      updatedAt: new Date().toISOString(),
      builtSpec: step.spec,
    }));
  }
  res.json({ status: await project.readStatus() });
});

app.post("/api/sync/accepted", async (req, res) => {
  const stepId = String(req.body?.stepId ?? "");
  if (!stepId) throw new HttpError(400, "Say which step the suggestion was about.");
  if (req.body?.removed) {
    await project.updateStep(stepId, () => null); // the code never had it, so nothing is left to remove
    res.json({ ok: true });
    return;
  }
  const spec = StepSpecSchema.parse(req.body?.spec);
  const files = (Array.isArray(req.body?.files) ? req.body.files : []).map(String);
  const hashes = await fingerprint(project, files);
  await project.updateStep(stepId, (current) => ({
    state: "built",
    note: current?.state === "built" && current.note ? current.note : "Already in the code (from an accepted suggestion).",
    files: [...new Set([...(current?.files ?? []), ...files])],
    fileHashes: { ...(current?.fileHashes ?? {}), ...hashes },
    agent: String(req.body?.source ?? current?.agent ?? ""),
    updatedAt: new Date().toISOString(),
    builtSpec: spec,
  }));
  res.json({ ok: true });
});

app.post("/api/sync/drift/:stepId/reviewed", async (req, res) => {
  await markReviewed(project, req.params.stepId);
  res.json({ ok: true });
});

/**
 * Live updates for the open app. The MCP server runs in a separate process (started by the
 * AI agent), so changes arrive through the files it writes.
 */
const listeners = new Set<express.Response>();
const send = (event: string, data: unknown) => {
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of listeners) res.write(message);
};

app.get("/api/events", async (req, res) => {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.write(`event: status\ndata: ${JSON.stringify(await project.readStatus())}\n\n`);
  listeners.add(res);
  const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
  req.on("close", () => {
    clearInterval(ping);
    listeners.delete(res);
  });
});

const pending = new Map<string, NodeJS.Timeout>();
let flowWatcher: FSWatcher | undefined;
async function watchFlow() {
  flowWatcher?.close();
  for (const t of pending.values()) clearTimeout(t);
  // Makes sure .flowcommit/ exists before watching it. A flow that can't be read (say, a merge
  // conflict) is reported by the editor, and still watched so fixing it shows up right away.
  await mkdir(path.join(project.root, FLOW_DIR), { recursive: true });
  await project.readFlow().catch(() => {});
  const watched = project;
  flowWatcher = watch(path.join(watched.root, FLOW_DIR), (_event, file) => {
    if (file !== STATUS_FILE && file !== FLOW_FILE && file !== SUGGESTIONS_FILE) return;
    clearTimeout(pending.get(file));
    pending.set(
      file,
      setTimeout(async () => {
        if (watched !== project) return; // another project was opened meanwhile
        if (file === STATUS_FILE) {
          send("status", await project.readStatus());
        } else if (file === SUGGESTIONS_FILE) {
          send("suggestions", await project.readSuggestions());
        } else {
          const text = await readFile(project.flowPath, "utf8").catch(() => "");
          if (text && !project.wroteFlow(text)) send("flow", { changed: true });
        }
      }, 80),
    );
  });
}

/**
 * Git writes these files whenever a commit, checkout, pull, fetch or push happens, whether it was
 * done here, in a terminal, or by an AI agent. Watching them keeps History and branches current.
 * (The index file is left out on purpose: reading the repository touches it, which would loop.)
 */
const GIT_ACTIVITY = new Set(["HEAD", "FETCH_HEAD", "ORIG_HEAD", "packed-refs"]);
let gitWatchers: ReturnType<typeof watch>[] = [];
let gitTimer: NodeJS.Timeout | undefined;
async function watchGit() {
  for (const w of gitWatchers) w.close();
  gitWatchers = [];
  let dir: string;
  try {
    dir = (await git(project.root, ["rev-parse", "--absolute-git-dir"])).trim();
  } catch {
    return; // not a repository yet
  }
  const notify = () => {
    clearTimeout(gitTimer);
    gitTimer = setTimeout(() => send("git", { changed: true }), 250);
  };
  const add = (target: string, opts: { recursive?: boolean }, filter?: (f: string) => boolean) => {
    try {
      gitWatchers.push(watch(target, opts, (_e, f) => (!filter || (f && filter(String(f)))) && notify()));
    } catch {
      // Some folders only exist after the first commit; they're picked up on the next restart.
    }
  };
  add(dir, {}, (f) => GIT_ACTIVITY.has(f));
  add(path.join(dir, "logs"), {}, (f) => f === "HEAD");
  add(path.join(dir, "refs"), { recursive: true }, (f) => !f.endsWith(".lock"));
}

/**
 * Switches FlowCommit to another project folder. A folder without a flow gets an empty one.
 * Open pages are told, and reload.
 */
async function openProject(root: string) {
  project = new Project(root);
  history = new History(project);
  repo = new Repo(project, history);
  assets = express.static(project.assetsDir, { fallthrough: false });
  await watchFlow();
  await watchGit();
  await rememberProject(project.root, project.name).catch(() => {});
  send("project", { name: project.name, path: project.root });
  emit("projectOpened", { project: projectInfo() });
}

// Plugins load before the first request, so the editor sees everything they add.
await loadPlugins(FLOWCOMMIT_VERSION);
emit("projectOpened", { project: projectInfo() });

await watchFlow();
await watchGit();
await rememberProject(project.root, project.name).catch(() => {});

let assets = express.static(project.assetsDir, { fallthrough: false });
app.use("/api/assets", (req, res, next) => assets(req, res, next));

const onError: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ error: "The flow has invalid data.", issues: err.issues });
    return;
  }
  if (err?.type === "entity.too.large") {
    res.status(413).json({ error: `Files must be smaller than ${MAX_UPLOAD}.` });
    return;
  }
  const status = typeof err?.status === "number" ? err.status : 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err?.message ?? "Something went wrong on the server." });
};
app.use(onError);

/**
 * The installed app (npm run build) serves the editor itself, so it's all on one port. During
 * development Vite serves the editor instead.
 */
const webDir = process.env.FLOWCOMMIT_WEB_DIR ?? path.join(import.meta.dirname, "../web");
const serveWeb = existsSync(path.join(webDir, "index.html"));
if (serveWeb) {
  app.use(express.static(webDir, { index: "index.html" }));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(webDir, "index.html")));
}

// The command-line app looks for a free port when you didn't ask for a particular one.
const AUTO_PORT = process.env.FLOWCOMMIT_PORT_AUTO === "1";
function listen(port: number, triesLeft: number) {
  // Express 5 calls this on failure too; failures are handled below.
  const listener = app.listen(port, "127.0.0.1", (err?: Error) => {
    if (err) return;
    const url = `http://localhost:${port}`;
    console.log(serveWeb ? `FlowCommit is running at ${url}` : `FlowCommit server on http://127.0.0.1:${port}`);
    console.log(`Project: ${project.root}`);
    if (serveWeb && process.env.FLOWCOMMIT_OPEN === "1") openWithSystem(url);
  });
  listener.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code !== "EADDRINUSE") throw err;
    if (AUTO_PORT && triesLeft > 0) return listen(port + 1, triesLeft - 1);
    console.error(
      serveWeb
        ? `Port ${port} is already used. Pick another one: flowcommit --port ${port + 1}`
        : `Port ${port} is already used, probably by another FlowCommit. Stop it, or run this one on other ports: FLOWCOMMIT_PORT=4319 FLOWCOMMIT_WEB_PORT=5319 npm run dev`,
    );
    process.exit(1);
  });
}
listen(PORT, 20);

/** Opens a link or file the way double-clicking it would. */
function openWithSystem(target: string) {
  const [cmd, args] =
    process.platform === "darwin"
      ? ["open", [target]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", target]]
        : ["xdg-open", [target]];
  spawn(cmd, args, { stdio: "ignore", detached: true })
    .on("error", () => console.log(`Open ${target} yourself; FlowCommit couldn't.`))
    .unref();
}
