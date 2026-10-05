/**
 * The FlowCommit plugin API, version 1.
 *
 * A plugin is a JavaScript module whose default export is a `FlowCommitPlugin`. FlowCommit loads
 * the plugins listed in `~/.flowcommit/config.json` when it starts, and calls `setup` once with
 * the connection points below. Plugins run inside the local FlowCommit server, with the same
 * access to the computer as FlowCommit itself, so only install plugins you trust.
 *
 * FlowCommit works fully without any plugin: each connection point has a free, local default,
 * and plugins add more choices (templates from a marketplace, cloud share links, cloud builders).
 *
 * ```js
 * export default {
 *   name: "my-plugin",
 *   apiVersion: 1,
 *   setup(flowcommit) {
 *     flowcommit.addTemplateSource({ id: "mine", label: "My templates", list: async () => [], get: async () => null });
 *   },
 * };
 * ```
 */
import { z } from "zod";
import type { DraftFlow } from "./ai.ts";
import { DraftFlowSchema } from "./ai.ts";
import type { FlowFile } from "./flow.ts";

export const PLUGIN_API_VERSION = 1;

export type FlowCommitPlugin = {
  /** A short unique name, like the npm package's name. */
  name: string;
  /** The plugin API version it was written for. FlowCommit skips plugins written for another. */
  apiVersion: number;
  setup: (flowcommit: PluginContext) => void | Promise<void>;
};

/** Helps editors type-check a plugin. It returns the plugin unchanged. */
export const definePlugin = (plugin: FlowCommitPlugin) => plugin;

export type PluginContext = {
  /** The plugin API version FlowCommit speaks. */
  apiVersion: number;
  /** The FlowCommit version, like "0.1.0". */
  version: string;
  addTemplateSource: (source: TemplateSource) => void;
  addShareTarget: (target: ShareTarget) => void;
  addBuildRunner: (runner: BuildRunner) => void;
  on: <E extends keyof PluginEvents>(event: E, handler: (payload: PluginEvents[E]) => void | Promise<void>) => void;
  /** Writes to FlowCommit's own log, prefixed with the plugin's name. */
  log: (message: string) => void;
};

/** The project a call is about. */
export type ProjectInfo = { name: string; root: string };

// ----- Template sources: where "start from a template" finds its templates -----

export type TemplateSummary = {
  id: string;
  title: string;
  /** A few words, like "Products, cart, payment". */
  blurb: string;
  /** Step kinds in order, for the little preview on the card. */
  preview?: string[];
  /** Shown on the card when set, like "$9" or "Free". */
  price?: string;
  author?: string;
};

export type Template = TemplateSummary & {
  /** What the app is, put in the flow's "What are you building?" box. */
  description: string;
  flow: DraftFlow;
};

export type TemplateSource = {
  id: string;
  label: string;
  list: () => Promise<TemplateSummary[]>;
  /** The full template, or null if it's gone or isn't available to this person. */
  get: (id: string) => Promise<Template | null>;
};

export const TemplateSchema = z.object({
  id: z.string(),
  title: z.string(),
  blurb: z.string().default(""),
  description: z.string().default(""),
  preview: z.array(z.string()).optional(),
  price: z.string().optional(),
  author: z.string().optional(),
  flow: DraftFlowSchema,
});

// ----- Share targets: places a flow can be sent, like a cloud share link -----

export type ShareRequest = { project: ProjectInfo; flow: FlowFile };

export type ShareResult = {
  /** What happened, in a sentence: "Anyone with the link can view this flow." */
  message: string;
  /** A link to show and copy, if there is one. */
  url?: string;
};

export type ShareTarget = {
  id: string;
  /** The button's words, like "Share a link". */
  label: string;
  description?: string;
  share: (request: ShareRequest) => Promise<ShareResult>;
};

// ----- Build runners: ways to build the flow besides the AI tools on this computer -----

export type BuildRunner = {
  id: string;
  label: string;
  /** One or two sentences shown in the Build window. */
  description: string;
  start: (request: ShareRequest) => Promise<ShareResult>;
};

// ----- Events: what happened, for plugins that sync, back up or notify -----

export type PluginEvents = {
  /** The design was saved to disk (this happens a moment after every edit). */
  flowSaved: { project: ProjectInfo; flow: FlowFile };
  versionSaved: { project: ProjectInfo; sha: string; message: string; withCode: boolean };
  pushed: { project: ProjectInfo; branch: string | null };
  projectOpened: { project: ProjectInfo };
};

/** What the editor is told about the plugins, without their code. */
export type PluginsInfo = {
  plugins: { name: string; source: string; error?: string }[];
  templateSources: { id: string; label: string }[];
  shareTargets: { id: string; label: string; description?: string }[];
  buildRunners: { id: string; label: string; description: string }[];
};
