import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  ASSETS_DIR,
  FLOW_DIR,
  FLOW_FILE,
  diffFlows,
  parseFlow,
  type DiffStats,
  type FlowFile,
} from "@flowcommit/shared";
import { GitError, git, gitAvailable } from "./git.ts";
import type { Project } from "./project.ts";

/**
 * - `no-git`: Git isn't installed.
 * - `not-repo`: the project folder isn't a Git repository yet.
 * - `ignored`: the folder is inside a repo that ignores `.flowcommit`.
 * - `ready`: versions can be saved.
 */
export type HistoryState = "no-git" | "not-repo" | "ignored" | "ready";

export type Version = {
  sha: string;
  number: number;
  message: string;
  author: string;
  date: string;
  stats: DiffStats | null;
};

const FLOW_PATH = `./${FLOW_DIR}/${FLOW_FILE}`;
const SHA = /^[0-9a-f]{7,40}$/;
const ASSET_NAME = /^[\w.-]+$/;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Version history for a project's design, stored as ordinary Git commits of `.flowcommit/`. */
export class History {
  // Commits never change, so the flow at a commit can be cached forever.
  private flowCache = new Map<string, FlowFile | null>();

  constructor(private project: Project) {}

  private run(args: string[]) {
    return git(this.project.root, args);
  }

  async state(): Promise<HistoryState> {
    if (!(await gitAvailable())) return "no-git";
    await mkdir(this.project.root, { recursive: true });
    try {
      await this.run(["rev-parse", "--show-toplevel"]);
    } catch {
      return "not-repo";
    }
    try {
      await this.run(["check-ignore", "-q", FLOW_PATH]);
      return "ignored";
    } catch {
      return "ready";
    }
  }

  async init(): Promise<void> {
    const state = await this.state();
    if (state === "no-git") throw new HttpError(409, "Git isn't installed on this computer.");
    if (state === "not-repo") await this.run(["init"]);
  }

  private async requireReady() {
    const state = await this.state();
    if (state === "no-git") throw new HttpError(409, "Git isn't installed on this computer.");
    if (state === "not-repo") throw new HttpError(409, "Version history isn't turned on for this folder yet.");
    if (state === "ignored") {
      throw new HttpError(409, "This folder's .gitignore ignores .flowcommit, so versions can't be saved.");
    }
  }

  /** Newest first. Each version's stats compare it with the version before it. */
  async list(): Promise<Version[]> {
    if ((await this.state()) !== "ready") return [];
    let out: string;
    try {
      out = await this.run(["log", "--format=%H%x1f%an%x1f%aI%x1f%s%x1e", "--", FLOW_PATH]);
    } catch (err) {
      // A brand-new repository has no commits yet.
      if (err instanceof GitError && /does not have any commits/.test(err.stderr)) return [];
      throw err;
    }
    const rows = out
      .split("\x1e")
      .map((r) => r.trim())
      .filter(Boolean)
      .map((r) => r.split("\x1f"));

    const versions: Version[] = [];
    for (let i = 0; i < rows.length; i++) {
      const [sha, author, date, message] = rows[i];
      const after = await this.flowAt(sha);
      const before = i + 1 < rows.length ? await this.flowAt(rows[i + 1][0]) : null;
      versions.push({
        sha,
        number: rows.length - i,
        message,
        author,
        date,
        stats: after ? diffFlows(before, after).stats : null,
      });
    }
    return versions;
  }

  /** The flow as it was saved in a version, or `null` if that version's file can't be read. */
  async flowAt(sha: string): Promise<FlowFile | null> {
    if (!SHA.test(sha)) throw new HttpError(400, "That isn't a valid version id.");
    if (this.flowCache.has(sha)) return this.flowCache.get(sha)!;
    let flow: FlowFile | null;
    try {
      flow = parseFlow(JSON.parse(await this.run(["show", `${sha}:${FLOW_PATH}`])));
    } catch {
      flow = null;
    }
    this.flowCache.set(sha, flow);
    return flow;
  }

  async assetAt(sha: string, file: string): Promise<Buffer> {
    if (!SHA.test(sha) || !ASSET_NAME.test(file)) throw new HttpError(400, "That isn't a valid file.");
    try {
      return await git(this.project.root, ["show", `${sha}:./${FLOW_DIR}/${ASSETS_DIR}/${file}`], { binary: true });
    } catch {
      throw new HttpError(404, "That file isn't in this version.");
    }
  }

  async save(message: string): Promise<Version> {
    await this.requireReady();
    const text = message.trim();
    if (!text) throw new HttpError(400, "Describe what changed in this version.");

    await this.run(["add", "-A", "--", `./${FLOW_DIR}`]);
    try {
      await this.run(["diff", "--cached", "--quiet", "--", `./${FLOW_DIR}`]);
      throw new HttpError(409, "Nothing has changed since the last version.");
    } catch (err) {
      if (err instanceof HttpError) throw err;
      // `git diff --quiet` exits with an error when there are changes, which is what we want here.
    }

    // `--only` commits just the design folder, never anything else the user has staged.
    await this.run([...(await this.identityArgs()), "commit", "--only", "-m", text, "--", `./${FLOW_DIR}`]);
    const [latest] = await this.list();
    return latest;
  }

  /** Puts a saved version back into the working flow. It becomes a draft until the next save. */
  async restore(sha: string): Promise<FlowFile> {
    await this.requireReady();
    const flow = await this.flowAt(sha);
    if (!flow) throw new HttpError(404, "That version couldn't be read.");

    for (const node of flow.nodes) {
      for (const a of node.attachments) {
        if (a.kind === "link") continue;
        const file = path.join(this.project.assetsDir, a.src);
        try {
          await access(file);
        } catch {
          await mkdir(this.project.assetsDir, { recursive: true });
          await writeFile(file, await this.assetAt(sha, a.src)).catch(() => {});
        }
      }
    }
    await this.project.writeFlow(flow);
    return flow;
  }

  /** Commits need a name and email. Use a placeholder only if the user never set one up. */
  private async identityArgs(): Promise<string[]> {
    const has = async (key: string) => {
      try {
        return (await this.run(["config", key])).trim().length > 0;
      } catch {
        return false;
      }
    };
    const args: string[] = [];
    if (!(await has("user.name"))) args.push("-c", "user.name=FlowCommit");
    if (!(await has("user.email"))) args.push("-c", "user.email=flowcommit@localhost");
    return args;
  }
}
