/**
 * The projects FlowCommit knows about: the recently opened list, browsing folders to open one,
 * and starting a new one. Everything stays on this computer, in ~/.flowcommit/recent.json
 * (or $FLOWCOMMIT_HOME/recent.json).
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { FLOW_DIR, FLOW_FILE } from "@flowcommit/shared";
import { HttpError } from "./history.ts";

const HOME = process.env.FLOWCOMMIT_HOME ?? path.join(os.homedir(), ".flowcommit");
const RECENT_FILE = path.join(HOME, "recent.json");
const MAX_RECENT = 12;

const RecentSchema = z.object({
  projects: z.array(z.object({ path: z.string(), name: z.string(), openedAt: z.string() })),
});
export type RecentProject = z.infer<typeof RecentSchema>["projects"][number] & { missing?: boolean };

async function readRecentFile() {
  try {
    return RecentSchema.parse(JSON.parse(await readFile(RECENT_FILE, "utf8"))).projects;
  } catch {
    return [];
  }
}

/** Recently opened projects, newest first. Folders that were moved or deleted are marked, not dropped. */
export async function recentProjects(): Promise<RecentProject[]> {
  const list = await readRecentFile();
  return list.map((p) => (existsSync(p.path) ? p : { ...p, missing: true }));
}

export async function rememberProject(root: string, name: string): Promise<void> {
  const list = (await readRecentFile()).filter((p) => p.path !== root);
  list.unshift({ path: root, name, openedAt: new Date().toISOString() });
  await mkdir(HOME, { recursive: true });
  const tmp = `${RECENT_FILE}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify({ projects: list.slice(0, MAX_RECENT) }, null, 2) + "\n");
  await rename(tmp, RECENT_FILE);
}

export async function forgetProject(root: string): Promise<void> {
  const list = (await readRecentFile()).filter((p) => p.path !== root);
  await mkdir(HOME, { recursive: true });
  await writeFile(RECENT_FILE, JSON.stringify({ projects: list }, null, 2) + "\n");
}

export type FolderEntry = { name: string; path: string; flowcommit: boolean; git: boolean };
export type FolderListing = {
  path: string;
  parent: string | null;
  home: string;
  flowcommit: boolean;
  git: boolean;
  folders: FolderEntry[];
};

const SKIP = new Set(["node_modules", "Library", "Applications", "System", "Volumes", "dist", "build"]);

/** The folders inside one folder, for picking a project. Hidden and system folders are left out. */
export async function listFolders(dir: string | undefined): Promise<FolderListing> {
  const target = path.resolve(dir || os.homedir());
  let entries;
  try {
    if (!(await stat(target)).isDirectory()) throw new Error();
    entries = await readdir(target, { withFileTypes: true });
  } catch {
    throw new HttpError(404, `Can't open the folder ${target}.`);
  }
  const folders = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith(".") && !SKIP.has(e.name))
    .map((e) => {
      const full = path.join(target, e.name);
      return { name: e.name, path: full, ...markers(full) };
    })
    .sort((a, b) => Number(b.flowcommit) - Number(a.flowcommit) || a.name.localeCompare(b.name));
  const parent = path.dirname(target);
  return { path: target, parent: parent === target ? null : parent, home: os.homedir(), ...markers(target), folders };
}

function markers(dir: string) {
  return {
    flowcommit: existsSync(path.join(dir, FLOW_DIR, FLOW_FILE)),
    git: existsSync(path.join(dir, ".git")),
  };
}

/** Checks a folder can be opened as a project. */
export async function checkProjectFolder(dir: string): Promise<string> {
  const root = path.resolve(dir);
  try {
    if ((await stat(root)).isDirectory()) return root;
  } catch {
    // reported below
  }
  throw new HttpError(404, `There's no folder at ${root}.`);
}

/** Makes a new, empty project folder. Fails rather than reuse a folder that already has files. */
export async function createProjectFolder(parent: string, name: string): Promise<string> {
  const clean = name.trim();
  if (!clean || /[\\/:*?"<>|]/.test(clean) || clean.startsWith(".")) {
    throw new HttpError(400, "Use a folder name without slashes or special characters.");
  }
  const root = path.join(await checkProjectFolder(parent), clean);
  if (existsSync(root) && (await readdir(root)).length > 0) {
    throw new HttpError(409, `${root} already has files in it. Open it instead, or pick another name.`);
  }
  await mkdir(root, { recursive: true });
  return root;
}
