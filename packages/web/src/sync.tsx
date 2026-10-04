import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, type SyncState } from "./api.ts";

const EMPTY: SyncState = { suggestions: [], drift: [], removed: [] };

/** For each step: whether its code changed outside a build, and how many AI suggestions are about it. */
export type StepSync = { drift: boolean; suggestions: number };
export const SyncContext = createContext<Map<string, StepSync>>(new Map());
export const useStepSync = (id: string) => useContext(SyncContext).get(id);

/**
 * What needs attention to keep the design and the code in step: AI suggestions waiting for a
 * decision, code edited outside a build, and code left over from deleted steps.
 */
export function useSync() {
  const [state, setState] = useState<SyncState>(EMPTY);
  const refresh = useCallback(async () => {
    try {
      setState(await api.syncState());
    } catch {
      // Sync is extra; the editor works without it.
    }
  }, []);
  useEffect(() => {
    void refresh();
    // Code can be edited at any time in another app, so look again whenever the window regains focus.
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  const byStep = new Map<string, StepSync>();
  const touch = (id: string) => byStep.get(id) ?? { drift: false, suggestions: 0 };
  for (const d of state.drift) byStep.set(d.stepId, { ...touch(d.stepId), drift: true });
  for (const s of state.suggestions) {
    const c = s.change;
    const ids = c.type === "add-step" ? [c.after] : c.type === "edit-step" || c.type === "remove-step" ? [c.stepId] : [c.from];
    for (const id of ids) if (id) byStep.set(id, { ...touch(id), suggestions: touch(id).suggestions + 1 });
  }
  const count = state.suggestions.length + state.drift.length + state.removed.length;
  return { state, refresh, byStep, count };
}
