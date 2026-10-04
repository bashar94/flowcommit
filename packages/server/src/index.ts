import express, { type ErrorRequestHandler } from "express";
import path from "node:path";
import { existsSync, mkdirSync, watch } from "node:fs";
import { readFile } from "node:fs/promises";
import { ZodError } from "zod";
import {
  DraftFlowSchema,
  DraftRequestSchema,
  FLOW_DIR,
  FLOW_FILE,
  PROVIDER_IDS,
  STATUS_FILE,
  SUGGESTIONS_FILE,
  StepSpecSchema,
  WriteRequestSchema,
  pendingChanges,
  parseFlow,
} from "@flowcommit/shared";
import { Project } from "./project.ts";
import { History, HttpError } from "./history.ts";
import { git } from "./git.ts";
import { ask, cleanText, extractJson, providerStatus } from "./ai.ts";
import { DRAFT_SYSTEM, WRITE_SYSTEM, draftPrompt, writePrompt } from "./prompts.ts";
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

const PORT = Number(process.env.FLOWCOMMIT_PORT ?? 4318);
const MAX_UPLOAD = "50mb";
const ALLOWED_UPLOAD = /^(image|video)\//;

const demoRoot = path.resolve(import.meta.dirname, "../../../demo-project");
const projectRoot = process.env.FLOWCOMMIT_PROJECT ?? demoRoot;
const project = new Project(projectRoot);
const history = new History(project);
const repo = new Repo(project, history);

// The demo folder sits inside the FlowCommit repo, which ignores it, so it gets its own repository.
if (project.root === demoRoot && !existsSync(path.join(demoRoot, ".git"))) {
  mkdirSync(demoRoot, { recursive: true });
  await git(demoRoot, ["init", "-q"]);
}

const app = express();
app.use(express.json({ limit: "5mb" }));

app.get("/api/project", (_req, res) => {
  res.json({ name: project.name, path: project.root });
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

app.post("/api/git/push", async (_req, res) => {
  await repo.push();
  res.json({ ok: true });
});

app.get("/api/github/prs", async (_req, res) => {
  res.json(await repo.pullRequests());
});

app.post("/api/github/prs/:number/fetch", async (req, res) => {
  res.json(await repo.fetchPullRequest(Number(req.params.number), String(req.body?.base ?? "main")));
});

app.post("/api/versions", async (req, res) => {
  res.json(await history.save(String(req.body?.message ?? "")));
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

await project.readFlow(); // makes sure .flowcommit/ exists before watching it
const pending = new Map<string, NodeJS.Timeout>();
watch(path.join(project.root, FLOW_DIR), (_event, file) => {
  if (file !== STATUS_FILE && file !== FLOW_FILE && file !== SUGGESTIONS_FILE) return;
  clearTimeout(pending.get(file));
  pending.set(
    file,
    setTimeout(async () => {
      if (file === STATUS_FILE) {
        send("status", await project.readStatus());
      } else if (file === SUGGESTIONS_FILE) {
        send("suggestions", await project.readSuggestions());
      } else {
        const text = await readFile(project.flowPath, "utf8").catch(() => "");
        if (text && text !== project.lastWrittenFlow) send("flow", { changed: true });
      }
    }, 80),
  );
});

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
await watchGit();

app.use("/api/assets", express.static(project.assetsDir, { fallthrough: false }));

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

const listener = app.listen(PORT, "127.0.0.1", () => {
  console.log(`FlowCommit server on http://127.0.0.1:${PORT}`);
  console.log(`Project: ${project.root}`);
});
listener.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `Port ${PORT} is already used, probably by another FlowCommit. Stop it, or run this one on other ports: FLOWCOMMIT_PORT=4319 FLOWCOMMIT_WEB_PORT=5319 npm run dev`,
    );
    process.exit(1);
  }
  throw err;
});
