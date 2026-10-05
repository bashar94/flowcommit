/**
 * Starts the built FlowCommit for the editor tests, on its own port, with a throwaway home
 * folder and projects. Nothing here touches your own FlowCommit or ~/.flowcommit.
 */
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
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

// Plugins: the open example (templates from a folder) and a test plugin for the other connection points.
const home = path.join(root, "home");
const templates = path.join(root, "templates");
mkdirSync(home, { recursive: true });
mkdirSync(templates, { recursive: true });
writeFileSync(
  path.join(home, "config.json"),
  JSON.stringify({
    plugins: [
      path.resolve(import.meta.dirname, "../examples/plugins/local-templates"),
      path.resolve(import.meta.dirname, "plugins/test-plugin.mjs"),
    ],
  }),
);
writeFileSync(
  path.join(templates, "newsletter.json"),
  JSON.stringify({
    title: "Newsletter sign-up",
    blurb: "Form, confirm email, welcome",
    description: "A newsletter sign-up page with double opt-in.",
    flow: {
      name: "Newsletter",
      steps: [
        { id: "s1", kind: "start", title: "Visitor opens the page" },
        { id: "s2", kind: "screen", title: "Sign-up form" },
        { id: "s3", kind: "end", title: "Subscribed" },
      ],
      arrows: [
        { from: "s1", to: "s2" },
        { from: "s2", to: "s3" },
      ],
    },
  }),
);

const child = spawn(
  process.execPath,
  [path.resolve(import.meta.dirname, "../bin/flowcommit.mjs"), first, "--port", port, "--no-open"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      FLOWCOMMIT_HOME: home,
      FLOWCOMMIT_TEMPLATES_DIR: templates,
      E2E_EVENTS_FILE: path.join(root, "events.log"),
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
