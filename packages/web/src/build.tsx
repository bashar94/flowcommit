import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { buildPlan, buildView, emptyBuildStatus, type BuildStatus, type BuildView, type FlowFile, type StepBuild } from "@flowcommit/shared";
import { api, type BuildInfo } from "./api.ts";

export type StepBuildInfo = { view: BuildView; record?: StepBuild };

/** Build status for each step, read by the cards on the canvas. Empty in History view. */
export const BuildContext = createContext<Map<string, StepBuildInfo>>(new Map());
export const useStepBuild = (id: string) => useContext(BuildContext).get(id);

/**
 * Keeps build status in sync with what the AI agent is doing. The server pushes an event
 * whenever the agent's MCP server writes `.flowcommit/status.json`, and also when the flow file
 * or the Git repository changes outside the app.
 */
export function useBuild(
  flow: FlowFile,
  onFlowChangedOutside: () => void,
  onGitChanged: () => void,
  onSyncChanged: () => void,
) {
  const [info, setInfo] = useState<BuildInfo | null>(null);
  const [status, setStatus] = useState<BuildStatus>(emptyBuildStatus);
  const onOutside = useRef(onFlowChangedOutside);
  onOutside.current = onFlowChangedOutside;
  const onGit = useRef(onGitChanged);
  onGit.current = onGitChanged;
  const onSync = useRef(onSyncChanged);
  onSync.current = onSyncChanged;

  const refresh = useCallback(async () => {
    try {
      const next = await api.buildInfo();
      setInfo(next);
      setStatus(next.status);
    } catch {
      // Build status is extra; the editor works without it.
    }
  }, []);

  useEffect(() => {
    void refresh();
    const events = new EventSource("/api/events");
    events.addEventListener("status", (e) => {
      setStatus(JSON.parse((e as MessageEvent).data));
      onSync.current(); // a finished build changes which code counts as edited outside a build
    });
    // An AI agent suggested a flow change.
    events.addEventListener("suggestions", () => onSync.current());
    events.addEventListener("flow", () => onOutside.current());
    // A commit, checkout, pull or push happened, here or in a terminal.
    events.addEventListener("git", () => onGit.current());
    return () => events.close();
  }, [refresh]);

  const views = useMemo(
    () => new Map(flow.nodes.map((n) => [n.id, { view: buildView(n, status.steps[n.id]), record: status.steps[n.id] }])),
    [flow.nodes, status],
  );
  const plan = useMemo(() => buildPlan(flow, status), [flow, status]);

  const reset = useCallback(async (stepId: string) => {
    const { status: next } = await api.resetStep(stepId);
    setStatus(next);
  }, []);

  return { info, status, views, plan, refresh, reset };
}

export const BUILD_LABEL: Record<BuildView, string> = {
  todo: "Not built",
  building: "Building",
  built: "Built",
  outdated: "Changed since built",
  blocked: "Needs your answer",
};

/** MCP clients report names like "claude-code"; show the product name people know. */
export function agentLabel(name: string | undefined): string {
  if (!name) return "The AI builder";
  if (/claude/i.test(name)) return "Claude Code";
  if (/codex/i.test(name)) return "Codex";
  return name;
}
