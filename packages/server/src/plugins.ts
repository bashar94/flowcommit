/**
 * Loads plugins and keeps what they add: template sources, share targets, build runners and
 * event handlers. See packages/shared/src/plugin.ts for the API plugins are written against.
 *
 * Plugins come only from the person's own settings (~/.flowcommit/config.json), never from a
 * project folder, so opening someone else's project can't run code on this computer.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import {
  PLUGIN_API_VERSION,
  TemplateSchema,
  type BuildRunner,
  type FlowCommitPlugin,
  type PluginEvents,
  type PluginsInfo,
  type ShareTarget,
  type Template,
  type TemplateSource,
  type TemplateSummary,
} from "@flowcommit/shared";
import { HOME } from "./projects.ts";
import { HttpError } from "./history.ts";

export const CONFIG_FILE = path.join(HOME, "config.json");
/** Where `flowcommit plugin add <name>` installs plugins from npm. */
export const PLUGINS_DIR = path.join(HOME, "plugins");

const ConfigSchema = z.object({ plugins: z.array(z.string()).default([]) }).passthrough();
export type Config = z.infer<typeof ConfigSchema>;

export async function readConfig(): Promise<Config> {
  try {
    return ConfigSchema.parse(JSON.parse(await readFile(CONFIG_FILE, "utf8")));
  } catch {
    return { plugins: [] };
  }
}

export async function writeConfig(config: Config): Promise<void> {
  await mkdir(HOME, { recursive: true });
  const tmp = `${CONFIG_FILE}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(config, null, 2) + "\n");
  await rename(tmp, CONFIG_FILE);
}

const LIST_TIMEOUT_MS = 15_000;
const ACTION_TIMEOUT_MS = 120_000;

function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new HttpError(504, `${what} took too long to answer.`)), ms);
    work.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

type Owned<T> = T & { plugin: string };

class Registry {
  plugins: PluginsInfo["plugins"] = [];
  templateSources = new Map<string, Owned<TemplateSource>>();
  shareTargets = new Map<string, Owned<ShareTarget>>();
  buildRunners = new Map<string, Owned<BuildRunner>>();
  handlers = new Map<keyof PluginEvents, { plugin: string; fn: (payload: never) => void | Promise<void> }[]>();

  info(): PluginsInfo {
    return {
      plugins: this.plugins,
      templateSources: [...this.templateSources.entries()].map(([id, s]) => ({ id, label: s.label })),
      shareTargets: [...this.shareTargets.entries()].map(([id, t]) => ({ id, label: t.label, description: t.description })),
      buildRunners: [...this.buildRunners.entries()].map(([id, r]) => ({ id, label: r.label, description: r.description })),
    };
  }
}

export const registry = new Registry();

/** The file to import for a plugin: a module file, or a package folder's entry point. */
async function entryOf(spec: string): Promise<string> {
  const expanded = spec.startsWith("~/") ? path.join(os.homedir(), spec.slice(2)) : spec;
  const isPath = /^(\.|\/|[A-Za-z]:[\\/])/.test(expanded) || expanded.startsWith("~");
  const target = isPath ? path.resolve(HOME, expanded) : path.join(PLUGINS_DIR, "node_modules", spec);
  const info = await stat(target).catch(() => null);
  if (!info) {
    throw new Error(isPath ? `There's nothing at ${target}.` : `It isn't installed. Run: flowcommit plugin add ${spec}`);
  }
  if (info.isFile()) return target;
  let pkg: { exports?: unknown; module?: string; main?: string } = {};
  try {
    pkg = JSON.parse(await readFile(path.join(target, "package.json"), "utf8"));
  } catch {
    // A plain folder: look for an index file below.
  }
  const fromExports = (e: unknown): string | undefined => {
    if (typeof e === "string") return e;
    if (e && typeof e === "object") {
      const o = e as Record<string, unknown>;
      return fromExports(o["."] ?? o.import ?? o.default ?? o.node);
    }
    return undefined;
  };
  const rel = fromExports(pkg.exports) ?? pkg.module ?? pkg.main;
  const candidates = [rel, "index.mjs", "index.js"].filter((x): x is string => !!x).map((r) => path.join(target, r));
  const found = candidates.find((c) => existsSync(c));
  if (!found) throw new Error(`Couldn't find the plugin's code in ${target}.`);
  return found;
}

/** Loads every plugin in the settings. A plugin that fails is reported and skipped. */
export async function loadPlugins(version: string): Promise<void> {
  if (process.env.FLOWCOMMIT_NO_PLUGINS === "1") return;
  const { plugins } = await readConfig();
  for (const spec of plugins) {
    try {
      const file = await entryOf(spec);
      const mod = await import(pathToFileURL(file).href);
      const plugin = (mod.default ?? mod) as FlowCommitPlugin;
      if (!plugin || typeof plugin.setup !== "function" || typeof plugin.name !== "string") {
        throw new Error("It doesn't export a plugin (an object with a name and a setup function).");
      }
      if (plugin.apiVersion !== PLUGIN_API_VERSION) {
        throw new Error(`It was written for plugin API ${plugin.apiVersion}; this FlowCommit uses ${PLUGIN_API_VERSION}.`);
      }
      const name = plugin.name;
      const key = (id: string) => `${name}:${id}`;
      await plugin.setup({
        apiVersion: PLUGIN_API_VERSION,
        version,
        addTemplateSource: (s) => registry.templateSources.set(key(s.id), { ...s, plugin: name }),
        addShareTarget: (t) => registry.shareTargets.set(key(t.id), { ...t, plugin: name }),
        addBuildRunner: (r) => registry.buildRunners.set(key(r.id), { ...r, plugin: name }),
        on: (event, fn) => {
          const list = registry.handlers.get(event) ?? [];
          list.push({ plugin: name, fn: fn as (payload: never) => void });
          registry.handlers.set(event, list);
        },
        log: (message) => console.log(`[${name}] ${message}`),
      });
      registry.plugins.push({ name, source: spec });
      console.log(`Plugin loaded: ${name}`);
    } catch (err) {
      const error = (err as Error).message;
      registry.plugins.push({ name: spec, source: spec, error });
      console.error(`Plugin ${spec} didn't load: ${error}`);
    }
  }
}

/** Tells plugins something happened. Never waits for them, and their errors never reach the person. */
export function emit<E extends keyof PluginEvents>(event: E, payload: PluginEvents[E]): void {
  for (const { plugin, fn } of registry.handlers.get(event) ?? []) {
    Promise.resolve()
      .then(() => (fn as (p: PluginEvents[E]) => void | Promise<void>)(payload))
      .catch((err: Error) => console.error(`[${plugin}] ${event} handler failed: ${err.message}`));
  }
}

export async function listTemplates(): Promise<
  { source: { id: string; label: string }; templates: TemplateSummary[]; error?: string }[]
> {
  return Promise.all(
    [...registry.templateSources.entries()].map(async ([id, s]) => {
      try {
        const templates = await withTimeout(s.list(), LIST_TIMEOUT_MS, s.label);
        return { source: { id, label: s.label }, templates: Array.isArray(templates) ? templates : [] };
      } catch (err) {
        return { source: { id, label: s.label }, templates: [], error: (err as Error).message };
      }
    }),
  );
}

export async function getTemplate(sourceId: string, templateId: string): Promise<Template> {
  const source = registry.templateSources.get(sourceId);
  if (!source) throw new HttpError(404, "That template source isn't available.");
  const found = await withTimeout(source.get(templateId), ACTION_TIMEOUT_MS, source.label);
  if (!found) throw new HttpError(404, "That template isn't available any more.");
  const parsed = TemplateSchema.safeParse(found);
  if (!parsed.success) throw new HttpError(502, `${source.label} sent a template FlowCommit couldn't read.`);
  return parsed.data as Template;
}

export function shareTarget(id: string) {
  const t = registry.shareTargets.get(id);
  if (!t) throw new HttpError(404, "That sharing option isn't available.");
  return (request: Parameters<ShareTarget["share"]>[0]) => withTimeout(t.share(request), ACTION_TIMEOUT_MS, t.label);
}

export function buildRunner(id: string) {
  const r = registry.buildRunners.get(id);
  if (!r) throw new HttpError(404, "That builder isn't available.");
  return (request: Parameters<BuildRunner["start"]>[0]) => withTimeout(r.start(request), ACTION_TIMEOUT_MS, r.label);
}
