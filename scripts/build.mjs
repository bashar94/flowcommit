/**
 * Builds the app people install: the web app plus the server, MCP server and hook, each
 * bundled into one file with its dependencies, so `npx flowcommit` needs nothing else.
 *
 *   dist/web/            the editor (static files the server hands out)
 *   dist/server/*.js     node dist/server/index.js, mcp.js, hook.js
 */
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const dist = path.join(root, "dist");
rmSync(dist, { recursive: true, force: true });

execFileSync("npx", ["vite", "build", "--outDir", path.join(dist, "web"), "--emptyOutDir"], {
  cwd: path.join(root, "packages/web"),
  stdio: "inherit",
});

await build({
  entryPoints: ["index", "mcp", "hook"].map((name) => path.join(root, "packages/server/src", `${name}.ts`)),
  outdir: path.join(dist, "server"),
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  // Some dependencies still use require(); give them one.
  banner: { js: 'import { createRequire as __fcRequire } from "node:module"; const require = __fcRequire(import.meta.url);' },
  logLevel: "info",
});
