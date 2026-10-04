import { execFile } from "node:child_process";
import { FLOW_DIR, FLOW_FILE, diffFlows, type DiffStats } from "@flowcommit/shared";
import { GitError, git } from "./git.ts";
import { HttpError, type History } from "./history.ts";
import type { Project } from "./project.ts";

/**
 * Branches, the design's commit graph, and syncing with GitHub. Everything lives in the
 * project's own Git repository; FlowCommit only reads it and runs the same git commands a
 * person would, using their existing Git and GitHub sign-in.
 */

const FLOW_PATH = `./${FLOW_DIR}/${FLOW_FILE}`;
const MAX_COMMITS = 300;
const NETWORK_TIMEOUT_MS = 60_000;

export type GraphCommit = {
  sha: string;
  /** Parent commits that also changed the design, so the graph skips code-only commits. */
  parents: string[];
  author: string;
  date: string;
  message: string;
  stats: DiffStats | null;
};

export type Branch = {
  name: string;
  remote: boolean;
  /** The newest commit on this branch that changed the design. */
  tip: string | null;
  current: boolean;
};

export type Graph = {
  commits: GraphCommit[];
  branches: Branch[];
  current: { branch: string | null; tip: string | null };
  defaultBranch: string;
  sync: { upstream: string | null; ahead: number; behind: number };
  remote: { name: string; webUrl: string | null } | null;
};

const BRANCH_NAME = /^(?!-)[\w./-]+$/;

export class Repo {
  constructor(
    private project: Project,
    private history: History,
  ) {}

  private run(args: string[], timeoutMs?: number) {
    return git(this.project.root, args, { timeoutMs });
  }

  private async tryRun(args: string[]): Promise<string | null> {
    try {
      return (await this.run(args)).trim();
    } catch {
      return null;
    }
  }

  private async designTip(ref: string): Promise<string | null> {
    return (await this.tryRun(["log", "-1", "--format=%H", ref, "--", FLOW_PATH])) || null;
  }

  async graph(): Promise<Graph> {
    if ((await this.history.state()) !== "ready") {
      return {
        commits: [],
        branches: [],
        current: { branch: null, tip: null },
        defaultBranch: "main",
        sync: { upstream: null, ahead: 0, behind: 0 },
        remote: null,
      };
    }

    // --parents with path limiting rewrites each commit's parents to the nearest commits
    // that changed the design, which is exactly the graph we want to draw.
    const out =
      (await this.tryRun([
        "log",
        "--all",
        "--topo-order",
        "--full-history",
        "--simplify-merges",
        "--parents",
        `--max-count=${MAX_COMMITS}`,
        "--format=%H%x1f%P%x1f%an%x1f%aI%x1f%s%x1e",
        "--",
        FLOW_PATH,
      ])) ?? "";
    const rows = out
      .split("\x1e")
      .map((r) => r.trim())
      .filter(Boolean)
      .map((r) => r.split("\x1f"));
    const known = new Set(rows.map((r) => r[0]));

    const commits: GraphCommit[] = [];
    for (const [sha, parents, author, date, message] of rows) {
      const parentList = parents.split(" ").filter((p) => p && known.has(p));
      const after = await this.history.flowAt(sha);
      const before = parentList[0] ? await this.history.flowAt(parentList[0]) : null;
      commits.push({ sha, parents: parentList, author, date, message, stats: after ? diffFlows(before, after).stats : null });
    }

    const branch = await this.tryRun(["symbolic-ref", "--short", "-q", "HEAD"]);
    const refs = ((await this.tryRun(["for-each-ref", "--format=%(refname:short)%1f%(refname)", "refs/heads", "refs/remotes"])) ?? "")
      .split("\n")
      .filter(Boolean)
      .map((l) => l.split("\x1f"))
      .filter(([, full]) => !full.endsWith("/HEAD"));
    const branches: Branch[] = [];
    for (const [name, full] of refs) {
      branches.push({
        name,
        remote: full.startsWith("refs/remotes/"),
        tip: await this.designTip(full),
        current: name === branch,
      });
    }

    const upstream = await this.tryRun(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
    let ahead = 0;
    let behind = 0;
    if (upstream) {
      const counts = await this.tryRun(["rev-list", "--left-right", "--count", `HEAD...${upstream}`]);
      if (counts) [ahead, behind] = counts.split(/\s+/).map(Number);
    }

    const remoteName = (await this.tryRun(["remote"]))?.split("\n")[0] || null;
    const remoteUrl = remoteName ? await this.tryRun(["remote", "get-url", remoteName]) : null;

    return {
      commits,
      branches,
      current: { branch, tip: await this.designTip("HEAD") },
      defaultBranch: await this.defaultBranch(remoteName, branches),
      sync: { upstream, ahead, behind },
      remote: remoteName ? { name: remoteName, webUrl: remoteUrl ? webUrl(remoteUrl) : null } : null,
    };
  }

  private async defaultBranch(remote: string | null, branches: Branch[]): Promise<string> {
    if (remote) {
      const head = await this.tryRun(["symbolic-ref", "--short", "-q", `refs/remotes/${remote}/HEAD`]);
      if (head) return head.replace(`${remote}/`, "");
    }
    const local = branches.filter((b) => !b.remote).map((b) => b.name);
    return local.find((b) => b === "main") ?? local.find((b) => b === "master") ?? local[0] ?? "main";
  }

  async mergeBase(a: string, b: string): Promise<string | null> {
    checkRef(a);
    checkRef(b);
    const base = await this.tryRun(["merge-base", a, b]);
    if (!base) return null;
    // The design as it was when the branch started: the newest design commit at that point.
    return this.designTip(base);
  }

  /** Switches the whole working folder to another branch, just like `git switch`. */
  async switchBranch(name: string): Promise<void> {
    checkRef(name);
    const local = await this.tryRun(["rev-parse", "--verify", "-q", `refs/heads/${name}`]);
    try {
      if (local) await this.run(["switch", name]);
      else await this.run(["switch", "--track", name]); // e.g. origin/feature becomes a local feature branch
    } catch (err) {
      throw new HttpError(409, friendlyGitError(err, "switch branches"));
    }
  }

  async createBranch(name: string): Promise<void> {
    const clean = name.trim().replace(/\s+/g, "-");
    if (!BRANCH_NAME.test(clean) || (await this.tryRun(["check-ref-format", "--branch", clean])) === null) {
      throw new HttpError(400, "Branch names can use letters, numbers, dashes, dots and slashes, like design/new-checkout.");
    }
    try {
      await this.run(["switch", "-c", clean]);
    } catch (err) {
      throw new HttpError(409, friendlyGitError(err, "create the branch"));
    }
  }

  async fetch(): Promise<void> {
    try {
      await this.run(["fetch", "--all", "--prune"], NETWORK_TIMEOUT_MS);
    } catch (err) {
      throw new HttpError(502, friendlyGitError(err, "get updates from GitHub"));
    }
  }

  async pull(): Promise<void> {
    try {
      await this.run(["pull", "--ff-only"], NETWORK_TIMEOUT_MS);
    } catch (err) {
      throw new HttpError(409, friendlyGitError(err, "pull"));
    }
  }

  async push(): Promise<void> {
    const branch = await this.tryRun(["symbolic-ref", "--short", "-q", "HEAD"]);
    if (!branch) throw new HttpError(409, "Switch to a branch before pushing.");
    const remote = (await this.tryRun(["remote"]))?.split("\n")[0];
    if (!remote) throw new HttpError(409, "This project isn't connected to GitHub yet. Add a remote with `git remote add origin <url>`.");
    try {
      await this.run(["push", "--set-upstream", remote, branch], NETWORK_TIMEOUT_MS);
    } catch (err) {
      throw new HttpError(502, friendlyGitError(err, "push"));
    }
  }

  /** Pull requests, through the GitHub CLI when it's installed and signed in. */
  async pullRequests(): Promise<{ available: boolean; reason?: string; prs: PullRequest[] }> {
    const result = await gh(this.project.root, [
      "pr",
      "list",
      "--state",
      "open",
      "--limit",
      "30",
      "--json",
      "number,title,headRefName,baseRefName,author,url,updatedAt,isDraft",
    ]);
    if (!result.ok) return { available: false, reason: result.reason, prs: [] };
    const raw = JSON.parse(result.stdout) as (Omit<PullRequest, "author"> & { author: { login: string } })[];
    return { available: true, prs: raw.map((p) => ({ ...p, author: p.author?.login ?? "" })) };
  }

  /** Downloads a pull request's commits so its design changes can be reviewed on the canvas. */
  async fetchPullRequest(number: number, base: string): Promise<{ head: string | null; base: string | null }> {
    if (!Number.isInteger(number) || number <= 0) throw new HttpError(400, "That isn't a pull request number.");
    checkRef(base);
    const remote = (await this.tryRun(["remote"]))?.split("\n")[0];
    if (!remote) throw new HttpError(409, "This project isn't connected to GitHub.");
    // Stored as a remote branch (origin/pr/12), so the pull request shows up in the graph.
    const ref = `refs/remotes/${remote}/pr/${number}`;
    try {
      await this.run(["fetch", remote, `+pull/${number}/head:${ref}`, base], NETWORK_TIMEOUT_MS);
    } catch (err) {
      throw new HttpError(502, friendlyGitError(err, "download the pull request"));
    }
    return { head: await this.designTip(ref), base: await this.mergeBase(`${remote}/${base}`, `${remote}/pr/${number}`) };
  }
}

export type PullRequest = {
  number: number;
  title: string;
  headRefName: string;
  baseRefName: string;
  author: string;
  url: string;
  updatedAt: string;
  isDraft: boolean;
};

function checkRef(ref: string) {
  if (!BRANCH_NAME.test(ref) && !/^[0-9a-f]{7,40}$/.test(ref)) throw new HttpError(400, "That isn't a valid branch name.");
}

/** Turns git remote URLs (SSH or HTTPS) into the web address of the repository. */
export function webUrl(remote: string): string | null {
  const ssh = remote.match(/^git@([^:]+):(.+?)(\.git)?$/);
  if (ssh) return `https://${ssh[1]}/${ssh[2]}`;
  const https = remote.match(/^https?:\/\/(?:[^@/]+@)?([^/]+)\/(.+?)(\.git)?$/);
  if (https) return `https://${https[1]}/${https[2]}`;
  return null;
}

function friendlyGitError(err: unknown, action: string): string {
  const text = err instanceof GitError ? err.stderr : String(err);
  if (/would be overwritten|commit your changes or stash/i.test(text)) {
    return `Couldn't ${action}: you have unsaved changes that the other branch would overwrite. Save a version (and commit your code) first.`;
  }
  if (/terminal prompts disabled|could not read Username|Authentication failed|Permission denied|403/i.test(text)) {
    return `Couldn't ${action}: GitHub needs you to sign in. Run \`gh auth login\` (or push once from your terminal), then try again.`;
  }
  if (/Not possible to fast-forward|diverged/i.test(text)) {
    return `Couldn't ${action}: your branch and GitHub both have new commits. Pull and merge from your terminal, then come back.`;
  }
  if (/rejected/i.test(text)) return `Couldn't ${action}: GitHub has newer commits. Pull first, then push again.`;
  if (/already exists/i.test(text)) return `Couldn't ${action}: a branch with that name already exists.`;
  const last = text.trim().split("\n").pop();
  return last ? `Couldn't ${action}: ${last}` : `Couldn't ${action}.`;
}

function gh(cwd: string, args: string[]): Promise<{ ok: true; stdout: string } | { ok: false; reason: string }> {
  return new Promise((resolve) => {
    execFile("gh", args, { cwd, timeout: NETWORK_TIMEOUT_MS, env: { ...process.env, GH_PROMPT_DISABLED: "1" } }, (err, stdout, stderr) => {
      if (!err) return resolve({ ok: true, stdout });
      const text = `${stderr}`;
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return resolve({ ok: false, reason: "Install the GitHub CLI (gh) to see pull requests here." });
      }
      if (/auth login|not logged/i.test(text)) {
        return resolve({ ok: false, reason: "Sign in to the GitHub CLI with `gh auth login` to see pull requests here." });
      }
      if (/no git remotes|not a git repository|none of the git remotes/i.test(text)) {
        return resolve({ ok: false, reason: "This project isn't connected to a GitHub repository yet." });
      }
      resolve({ ok: false, reason: text.trim().split("\n").pop() || "Couldn't load pull requests." });
    });
  });
}
