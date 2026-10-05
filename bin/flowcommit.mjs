#!/usr/bin/env node
/**
 * FlowCommit from the command line.
 *
 *   flowcommit [folder]          opens the editor for a project (the current folder by default)
 *   flowcommit mcp --project X   the MCP server AI tools start (FlowCommit sets this up for you)
 *   flowcommit hook --project X  the Claude Code hook (also set up for you)
 *   flowcommit plugin add|remove|list   manage plugins
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const HELP = `FlowCommit: design your app as a flowchart, let AI build it, keep every version in Git.

Usage
  flowcommit [folder]     Open a project in your browser. Uses the current folder if you leave it out.

  flowcommit plugin add <npm-name or folder>
  flowcommit plugin remove <name or folder>
  flowcommit plugin list

Options
  --port <number>         Run on this port (normally the first free one from 4318)
  --no-open               Don't open the browser
  -h, --help              Show this help
  -v, --version           Show the version
`;

const HOME = process.env.FLOWCOMMIT_HOME ?? path.join(os.homedir(), ".flowcommit");
const CONFIG = path.join(HOME, "config.json");
const PLUGINS_DIR = path.join(HOME, "plugins");

const readConfig = () => {
  try {
    const config = JSON.parse(readFileSync(CONFIG, "utf8"));
    return { ...config, plugins: Array.isArray(config.plugins) ? config.plugins : [] };
  } catch {
    return { plugins: [] };
  }
};
const writeConfig = (config) => {
  mkdirSync(HOME, { recursive: true });
  writeFileSync(CONFIG, JSON.stringify(config, null, 2) + "\n");
};
const isPath = (s) => /^(\.|\/|~|[A-Za-z]:[\\/])/.test(s);

/** Plugins are listed in ~/.flowcommit/config.json; ones from npm are installed next to it. */
function plugin(action, spec) {
  const config = readConfig();
  if (action === "list") {
    if (!config.plugins.length) console.log("No plugins yet. Add one with: flowcommit plugin add <name or folder>");
    for (const p of config.plugins) console.log(p);
    return;
  }
  if (!spec) fail(`Say which plugin, like: flowcommit plugin ${action} flowcommit-plugin-name`);
  const entry = isPath(spec) ? path.resolve(spec.replace(/^~(?=\/)/, os.homedir())) : spec;
  if (action === "add") {
    if (isPath(spec)) {
      if (!existsSync(entry)) fail(`There's nothing at ${entry}.`);
    } else {
      mkdirSync(PLUGINS_DIR, { recursive: true });
      if (!existsSync(path.join(PLUGINS_DIR, "package.json"))) {
        writeFileSync(path.join(PLUGINS_DIR, "package.json"), JSON.stringify({ private: true }, null, 2) + "\n");
      }
      console.log(`Installing ${spec}…`);
      try {
        execFileSync("npm", ["install", "--prefix", PLUGINS_DIR, "--no-audit", "--no-fund", spec], { stdio: "inherit" });
      } catch {
        fail(`npm couldn't install ${spec}.`);
      }
    }
    const name = isPath(spec) ? entry : spec.replace(/@[^@/]+$/, "");
    if (!config.plugins.includes(name)) config.plugins.push(name);
    writeConfig(config);
    console.log(`Added ${name}. Restart FlowCommit to use it. Plugins run with full access to your computer, so only add ones you trust.`);
    return;
  }
  if (action === "remove") {
    const before = config.plugins.length;
    config.plugins = config.plugins.filter((p) => p !== entry && p !== spec);
    if (config.plugins.length === before) fail(`${spec} isn't in your plugins. See them with: flowcommit plugin list`);
    writeConfig(config);
    if (!isPath(spec)) {
      try {
        execFileSync("npm", ["uninstall", "--prefix", PLUGINS_DIR, "--no-audit", "--no-fund", spec], { stdio: "inherit" });
      } catch {
        // It's off the list either way.
      }
    }
    console.log(`Removed ${spec}. Restart FlowCommit to finish.`);
    return;
  }
  fail("Use flowcommit plugin add, remove or list.");
}

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

if (command === "plugin" || command === "plugins") {
  plugin(args[1] ?? "list", args[2]);
} else if (command === "mcp" || command === "hook") {
  // These read --project from the arguments themselves.
  await run(command);
} else if (args.includes("-h") || args.includes("--help")) {
  process.stdout.write(HELP);
} else if (args.includes("-v") || args.includes("--version")) {
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
