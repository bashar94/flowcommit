/**
 * Starts the built FlowCommit for the editor tests, on its own port, with a throwaway home
 * folder and projects. Nothing here touches your own FlowCommit or ~/.flowcommit.
 */
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const port = process.env.E2E_PORT ?? "4368";
// One folder per port, cleared on each run (and removed afterwards by e2e/teardown.ts).
const root = path.join(os.tmpdir(), `flowcommit-e2e-${port}`);
rmSync(root, { recursive: true, force: true });
const first = path.join(root, "projects", "first");
mkdirSync(first, { recursive: true });
execFileSync("git", ["init", "-q"], { cwd: first });
console.log(`E2E projects in ${root}`);

const child = spawn(
  process.execPath,
  [path.resolve(import.meta.dirname, "../bin/flowcommit.mjs"), first, "--port", port, "--no-open"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      FLOWCOMMIT_HOME: path.join(root, "home"),
      FLOWCOMMIT_E2E_ROOT: path.join(root, "projects"),
      GIT_AUTHOR_NAME: "E2E",
      GIT_AUTHOR_EMAIL: "e2e@example.com",
      GIT_COMMITTER_NAME: "E2E",
      GIT_COMMITTER_EMAIL: "e2e@example.com",
    },
  },
);
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
child.on("exit", (code) => process.exit(code ?? 0));
