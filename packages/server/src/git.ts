import { execFile } from "node:child_process";

export class GitError extends Error {
  constructor(
    message: string,
    readonly stderr: string,
    /** Some commands (like `git diff --no-index`) report results on stdout while exiting with an error. */
    readonly stdout = "",
  ) {
    super(message);
  }
}

const MAX_OUTPUT = 64 * 1024 * 1024;

type GitOptions = { binary?: boolean; timeoutMs?: number };

/** Runs git without a shell, so user text such as version messages can never be run as a command. */

export function git(cwd: string, args: string[], opts?: GitOptions & { binary?: false }): Promise<string>;
export function git(cwd: string, args: string[], opts: GitOptions & { binary: true }): Promise<Buffer>;
export function git(cwd: string, args: string[], opts: GitOptions = {}): Promise<string | Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      {
        cwd,
        maxBuffer: MAX_OUTPUT,
        encoding: opts.binary ? "buffer" : "utf8",
        timeout: opts.timeoutMs ?? 0,
        // Never stop to ask for a password in the background; report that sign-in is needed instead.
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" },
      },
      (err, stdout, stderr) => {
        if (err) {
          const text = String(stderr).trim();
          reject(new GitError(text || err.message, text, String(stdout)));
        } else {
          resolve(stdout);
        }
      },
    );
  });
}

export async function gitAvailable(): Promise<boolean> {
  try {
    await git(process.cwd(), ["--version"]);
    return true;
  } catch {
    return false;
  }
}
