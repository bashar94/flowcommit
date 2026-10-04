#!/usr/bin/env node
/**
 * FlowCommit from the command line.
 *
 *   flowcommit [folder]          opens the editor for a project (the current folder by default)
 *   flowcommit mcp --project X   the MCP server AI tools start (FlowCommit sets this up for you)
 *   flowcommit hook --project X  the Claude Code hook (also set up for you)
 */
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const HELP = `FlowCommit: design your app as a flowchart, let AI build it, keep every version in Git.

Usage
  flowcommit [folder]     Open a project in your browser. Uses the current folder if you leave it out.

Options
  --port <number>         Run on this port (normally the first free one from 4318)
  --no-open               Don't open the browser
  -h, --help              Show this help
  -v, --version           Show the version
`;

const dist = path.resolve(import.meta.dirname, "../dist/server");
const run = (name) => {
  const file = path.join(dist, `${name}.js`);
  if (!existsSync(file)) {
    console.error("FlowCommit isn't built yet. In the FlowCommit folder, run: npm run build");
    process.exit(1);
  }
  return import(pathToFileURL(file).href);
};

const args = process.argv.slice(2);
const command = args[0];

if (command === "mcp" || command === "hook") {
  // These read --project from the arguments themselves.
  await run(command);
} else if (args.includes("-h") || args.includes("--help")) {
  process.stdout.write(HELP);
} else if (args.includes("-v") || args.includes("--version")) {
  const { readFileSync } = await import("node:fs");
  console.log(JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../package.json"), "utf8")).version);
} else {
  let folder;
  let port;
  let open = true;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--port") port = args[++i];
    else if (arg.startsWith("--port=")) port = arg.slice("--port=".length);
    else if (arg === "--no-open") open = false;
    else if (arg.startsWith("-")) fail(`Unknown option ${arg}. Run flowcommit --help to see the options.`);
    else if (folder) fail("Give one folder at a time.");
    else folder = arg;
  }
  const root = path.resolve(folder ?? process.cwd());
  if (!existsSync(root) || !statSync(root).isDirectory()) fail(`There's no folder at ${root}.`);
  if (port !== undefined && !/^\d+$/.test(port)) fail("--port needs a number, like --port 4400.");

  process.env.FLOWCOMMIT_PROJECT = root;
  process.env.FLOWCOMMIT_PORT = port ?? process.env.FLOWCOMMIT_PORT ?? "4318";
  process.env.FLOWCOMMIT_PORT_AUTO = port ? "0" : "1";
  process.env.FLOWCOMMIT_OPEN = open ? "1" : "0";
  await run("index");
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
