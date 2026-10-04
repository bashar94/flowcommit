import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import {
  ASSETS_DIR,
  BuildStatusSchema,
  FLOW_DIR,
  FLOW_FILE,
  STATUS_FILE,
  SUGGESTIONS_FILE,
  SuggestionsFileSchema,
  createEmptyFlow,
  emptySuggestions,
  emptyBuildStatus,
  parseFlow,
  serializeFlow,
  type BuildStatus,
  type FlowFile,
  type StepBuild,
  type Suggestion,
  type SuggestionsFile,
} from "@flowcommit/shared";

/** A folder on disk whose design lives in `.flowcommit/`. */
export class Project {
  readonly root: string;
  readonly flowPath: string;
  readonly assetsDir: string;
  readonly statusPath: string;
  readonly suggestionsPath: string;
  /** The flow texts this process wrote last, so a file watcher can ignore our own saves. */
  private recentWrites: string[] = [];
  private writeCount = 0;

  constructor(root: string) {
    this.root = path.resolve(root);
    this.flowPath = path.join(this.root, FLOW_DIR, FLOW_FILE);
    this.assetsDir = path.join(this.root, FLOW_DIR, ASSETS_DIR);
    this.statusPath = path.join(this.root, FLOW_DIR, STATUS_FILE);
    this.suggestionsPath = path.join(this.root, FLOW_DIR, SUGGESTIONS_FILE);
  }

  get name(): string {
    return path.basename(this.root);
  }

  async readFlow(): Promise<FlowFile> {
    let raw: string;
    try {
      raw = await readFile(this.flowPath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      const flow = createEmptyFlow(this.name);
      await this.writeFlow(flow);
      return flow;
    }
    if (/^<<<<<<< /m.test(raw)) {
      throw Object.assign(
        new Error(
          "The design has a merge conflict from Git. Open .flowcommit/flow.json in your code editor and keep one side of each <<<<<<< block, or run `git merge --abort` to undo the merge.",
        ),
        { status: 409 },
      );
    }
    return parseFlow(JSON.parse(raw));
  }

  async writeFlow(flow: FlowFile): Promise<void> {
    await mkdir(path.dirname(this.flowPath), { recursive: true });
    // Write to a temp file first so a crash never leaves a half-written flow behind.
    const tmp = `${this.flowPath}.${process.pid}-${++this.writeCount}.tmp`;
    const text = serializeFlow(flow);
    this.recentWrites = [...this.recentWrites.slice(-7), text];
    await writeFile(tmp, text, "utf8");
    await rename(tmp, this.flowPath);
  }

  /** True when the flow on disk is one this process saved, not an edit from somewhere else. */
  wroteFlow(text: string): boolean {
    return this.recentWrites.includes(text);
  }

  async readStatus(): Promise<BuildStatus> {
    try {
      return BuildStatusSchema.parse(JSON.parse(await readFile(this.statusPath, "utf8")));
    } catch {
      return emptyBuildStatus();
    }
  }

  /** Applies a change to one step's build record. Pass `null` to forget the step's build. */
  async updateStep(id: string, next: (current: StepBuild | undefined) => StepBuild | null): Promise<BuildStatus> {
    return this.updateStatus((status) => {
      const value = next(status.steps[id]);
      if (value) status.steps[id] = value;
      else delete status.steps[id];
    });
  }

  async updateStatus(change: (status: BuildStatus) => void): Promise<BuildStatus> {
    const status = await this.readStatus();
    change(status);
    await this.writeLocal(this.statusPath, status);
    return status;
  }

  async readSuggestions(): Promise<SuggestionsFile> {
    try {
      return SuggestionsFileSchema.parse(JSON.parse(await readFile(this.suggestionsPath, "utf8")));
    } catch {
      return emptySuggestions();
    }
  }

  async addSuggestions(list: Suggestion[]): Promise<SuggestionsFile> {
    const file = await this.readSuggestions();
    file.suggestions.push(...list);
    await this.writeLocal(this.suggestionsPath, file);
    return file;
  }

  async removeSuggestion(id: string): Promise<SuggestionsFile> {
    const file = await this.readSuggestions();
    file.suggestions = file.suggestions.filter((s) => s.id !== id);
    await this.writeLocal(this.suggestionsPath, file);
    return file;
  }

  /** Files that describe this computer (build status, pending suggestions) and stay out of versions. */
  private async writeLocal(file: string, data: unknown) {
    await mkdir(path.dirname(file), { recursive: true });
    await this.keepLocalFilesOutOfVersions();
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
    await rename(tmp, file);
  }

  /** Build status and pending suggestions are about this computer, not the design, so Git skips them. */
  private async keepLocalFilesOutOfVersions() {
    const ignore = path.join(this.root, FLOW_DIR, ".gitignore");
    const current = await readFile(ignore, "utf8").catch(() => "");
    const lines = current.split("\n");
    const missing = [STATUS_FILE, SUGGESTIONS_FILE, "*.tmp"].filter((f) => !lines.includes(f));
    if (missing.length) {
      await writeFile(ignore, `${current}${current && !current.endsWith("\n") ? "\n" : ""}${missing.join("\n")}\n`, "utf8");
    }
  }

  /** Saves an uploaded file and returns its path relative to the assets folder. */
  async saveAsset(originalName: string, data: Buffer): Promise<string> {
    await mkdir(this.assetsDir, { recursive: true });
    const ext = path.extname(originalName).toLowerCase().replace(/[^.a-z0-9]/g, "");
    const base = path
      .basename(originalName, path.extname(originalName))
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40);
    const fileName = `${base || "file"}-${nanoid(8)}${ext}`;
    await writeFile(path.join(this.assetsDir, fileName), data);
    return fileName;
  }
}
