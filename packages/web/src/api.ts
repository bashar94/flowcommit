import type {
  BuildStatus,
  DiffStats,
  DraftFlow,
  FlowFile,
  ProviderId,
  StepSpec,
  Suggestion,
  SuggestionsFile,
  WriteRequest,
} from "@flowcommit/shared";

export type Provider = {
  id: ProviderId;
  label: string;
  available: boolean;
  version: string | null;
  install: string;
};

export type BuildInfo = {
  status: BuildStatus;
  claudeConnected: boolean;
  claudeHook: boolean;
  agentsInstructions: boolean;
  commands: { claude: string; codex: string };
  projectPath: string;
};

export type GraphCommit = {
  sha: string;
  parents: string[];
  author: string;
  date: string;
  message: string;
  stats: DiffStats | null;
};

export type Branch = { name: string; remote: boolean; tip: string | null; current: boolean };

export type Graph = {
  commits: GraphCommit[];
  branches: Branch[];
  current: { branch: string | null; tip: string | null };
  defaultBranch: string;
  sync: { upstream: string | null; ahead: number; behind: number };
  remote: { name: string; webUrl: string | null } | null;
};

export type PullRequest = {
  number: number;
  title: string;
  headRefName: string;
  baseRefName: string;
  author: string;
  url: string;
  updatedAt: string;
  isDraft: boolean;
};

export type Drift = { stepId: string; title: string; files: { file: string; deleted: boolean }[] };

export type SyncState = {
  suggestions: Suggestion[];
  drift: Drift[];
  removed: { id: string; title: string; files: string[] }[];
};

export type HistoryState = "no-git" | "not-repo" | "ignored" | "ready";

export type Version = {
  sha: string;
  number: number;
  message: string;
  author: string;
  date: string;
  stats: DiffStats | null;
};

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const UNREACHABLE = "Can't reach the FlowCommit server. Start it with npm run dev, then try again.";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new Error(UNREACHABLE);
  }
  // The dev proxy answers 502-504 when the FlowCommit server is down or restarting.
  if (res.status >= 502 && res.status <= 504) throw new Error(UNREACHABLE);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `The server answered with status ${res.status}.`);
  return body as T;
}

export const api = {
  project: () => request<{ name: string; path: string }>("/api/project"),

  loadFlow: () => request<FlowFile>("/api/flow"),

  saveFlow: (flow: FlowFile, opts: { keepalive?: boolean } = {}) =>
    request<{ ok: true }>("/api/flow", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(flow),
      keepalive: opts.keepalive,
    }),

  history: () => request<{ state: HistoryState; versions: Version[] }>("/api/history"),

  turnOnHistory: () => request<{ state: HistoryState }>("/api/history/init", { method: "POST" }),

  saveVersion: (message: string) => request<Version>("/api/versions", json({ message })),

  versionFlow: (sha: string) => request<FlowFile>(`/api/versions/${sha}/flow`),

  restoreVersion: (sha: string) => request<FlowFile>(`/api/versions/${sha}/restore`, { method: "POST" }),

  aiProviders: () => request<{ providers: Provider[] }>("/api/ai"),

  aiWrite: (body: WriteRequest, signal?: AbortSignal) =>
    request<{ text: string }>("/api/ai/write", { ...json(body), signal }),

  aiDraft: (body: { provider: ProviderId; description: string }, signal?: AbortSignal) =>
    request<DraftFlow>("/api/ai/draft", { ...json(body), signal }),

  buildInfo: () => request<BuildInfo>("/api/build"),

  resetStep: (stepId: string) => request<{ status: BuildStatus }>("/api/build/reset", json({ stepId })),

  connectClaude: (opts: { hook: boolean }) => request<{ claudeConnected: true }>("/api/connect/claude", json(opts)),

  connectAgents: () => request<{ agentsInstructions: true }>("/api/connect/agents", { method: "POST" }),

  syncState: () => request<SyncState>("/api/sync"),

  dismissSuggestion: (id: string) => request<SuggestionsFile>(`/api/sync/suggestions/${encodeURIComponent(id)}`, { method: "DELETE" }),

  suggestFromCode: (provider: ProviderId, signal?: AbortSignal) =>
    request<{ added: number }>("/api/sync/analyze", { ...json({ provider }), signal }),

  suggestionAccepted: (body: { stepId: string; spec?: StepSpec; files?: string[]; source?: string; removed?: boolean }) =>
    request<{ ok: true }>("/api/sync/accepted", json(body)),

  markReviewed: (stepId: string) => request<{ ok: true }>(`/api/sync/drift/${encodeURIComponent(stepId)}/reviewed`, { method: "POST" }),

  graph: () => request<Graph>("/api/graph"),

  mergeBase: (a: string, b: string) =>
    request<{ sha: string | null }>(`/api/git/merge-base?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`),

  switchBranch: (branch: string) => request<{ ok: true }>("/api/git/switch", json({ branch })),

  createBranch: (name: string) => request<{ ok: true }>("/api/git/branch", json({ name })),

  fetchRemote: () => request<{ ok: true }>("/api/git/fetch", { method: "POST" }),

  pull: () => request<{ ok: true }>("/api/git/pull", { method: "POST" }),

  push: () => request<{ ok: true }>("/api/git/push", { method: "POST" }),

  pullRequests: () => request<{ available: boolean; reason?: string; prs: PullRequest[] }>("/api/github/prs"),

  fetchPullRequest: (n: number, base: string) =>
    request<{ head: string | null; base: string | null }>(`/api/github/prs/${n}/fetch`, json({ base })),

  uploadAsset: (file: File) =>
    request<{ src: string; kind: "image" | "video" }>(
      `/api/assets?name=${encodeURIComponent(file.name || "pasted-image.png")}`,
      { method: "POST", headers: { "Content-Type": file.type }, body: file },
    ),
};
