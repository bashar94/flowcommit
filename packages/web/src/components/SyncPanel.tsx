import { useState } from "react";
import { describeSuggestion, type FlowFile, type Suggestion } from "@flowcommit/shared";
import { api, type SyncState } from "../api.ts";
import { useAi } from "../ai.tsx";
import { Icon } from "../icons.tsx";
import { timeAgo } from "../time.ts";

type Props = {
  state: SyncState;
  flow: FlowFile;
  onAccept: (s: Suggestion) => void;
  onDismiss: (s: Suggestion) => void;
  onShowStep: (id: string) => void;
  onAnalyzed: (added: number) => void;
  onClose: () => void;
};

const CHANGE_ICON = {
  "add-step": "plus",
  "edit-step": "markup",
  "remove-step": "close",
  "add-arrow": "arrowRight",
  "remove-arrow": "close",
} as const;

/**
 * Where the design and the code meet. AI tools never change the flowchart themselves: they
 * suggest, and the person decides here. Code edited outside a build is flagged, so it can be
 * turned into suggestions instead of quietly drifting away from the design.
 */
export function SyncPanel({ state, flow, onAccept, onDismiss, onShowStep, onAnalyzed, onClose }: Props) {
  const { active } = useAi();
  const [running, setRunning] = useState<{ controller: AbortController; whole: boolean } | null>(null);
  const [error, setError] = useState("");

  const analyze = async (whole: boolean) => {
    if (!active) return;
    const controller = new AbortController();
    setRunning({ controller, whole });
    setError("");
    try {
      const { added } = await api.suggestFromCode(active.id, controller.signal);
      onAnalyzed(added);
    } catch (err) {
      if ((err as Error).name !== "AbortError") setError((err as Error).message);
    } finally {
      setRunning(null);
    }
  };

  const nothing = !state.suggestions.length && !state.drift.length && !state.removed.length;

  return (
    <aside className="inspector panel sync-panel" aria-label="Design and code">
      <div className="inspector-section">
        <div className="sync-head">
          <h2 className="inspector-title">Design and code</h2>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            <Icon name="close" size={14} />
          </button>
        </div>
        <p className="inspector-note">
          AI tools never change your flowchart on their own. When the code does something the flowchart doesn't show,
          they suggest a change here, and you decide.
        </p>
        {nothing && (
          <p className="sync-ok">
            <Icon name="check" size={14} /> The design and the code are in step.
          </p>
        )}
      </div>

      {state.suggestions.length > 0 && (
        <div className="inspector-section">
          <h3 className="dialog-subtitle">Suggestions ({state.suggestions.length})</h3>
          <ul className="suggestion-list">
            {state.suggestions.map((s) => {
              const anchor = s.change.type === "add-step" ? s.change.after : s.change.type === "edit-step" || s.change.type === "remove-step" ? s.change.stepId : s.change.from;
              return (
                <li key={s.id} className="suggestion" data-type={s.change.type}>
                  <div className="suggestion-title">
                    <span className="suggestion-icon">
                      <Icon name={CHANGE_ICON[s.change.type]} size={13} />
                    </span>
                    <span>{describeSuggestion(s, flow)}</span>
                  </div>
                  {s.reason && <p className="suggestion-reason">{s.reason}</p>}
                  {s.change.type === "edit-step" && s.change.instructions && (
                    <p className="suggestion-detail">New instructions: {s.change.instructions}</p>
                  )}
                  {s.change.type === "edit-step" && s.change.addInstructions && (
                    <p className="suggestion-detail">Adds: {s.change.addInstructions}</p>
                  )}
                  {s.change.type === "add-step" && s.change.step.instructions && (
                    <p className="suggestion-detail">{s.change.step.instructions}</p>
                  )}
                  <p className="suggestion-meta">
                    {s.source || "AI"}, {timeAgo(s.createdAt)}
                    {s.files.map((f) => (
                      <code key={f}>{f}</code>
                    ))}
                  </p>
                  <div className="confirm-actions">
                    <button type="button" className="button-primary" onClick={() => onAccept(s)}>
                      Accept
                    </button>
                    <button type="button" className="button-quiet" onClick={() => onDismiss(s)}>
                      Dismiss
                    </button>
                    {anchor && (
                      <button type="button" className="button-quiet" onClick={() => onShowStep(anchor)}>
                        Show step
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {state.drift.length > 0 && (
        <div className="inspector-section">
          <h3 className="dialog-subtitle">Code changed outside a build ({state.drift.length})</h3>
          <p className="inspector-note">
            These steps' code was edited after it was built, without going through the flowchart. Let AI read the
            changes and suggest how the flowchart should change.
          </p>
          <ul className="drift-list">
            {state.drift.map((d) => (
              <li key={d.stepId}>
                <button type="button" className="drift-step" onClick={() => onShowStep(d.stepId)}>
                  {d.title}
                </button>
                {d.files.map((f) => (
                  <code key={f.file}>
                    {f.file}
                    {f.deleted ? " (deleted)" : ""}
                  </code>
                ))}
                <button
                  type="button"
                  className="button-quiet drift-ok"
                  title="The flowchart already describes this code; stop flagging it"
                  onClick={async () => {
                    await api.markReviewed(d.stepId);
                    onAnalyzed(-1);
                  }}
                >
                  Mark as reviewed
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {state.removed.length > 0 && (
        <div className="inspector-section">
          <h3 className="dialog-subtitle">Removed steps with code left over ({state.removed.length})</h3>
          <p className="inspector-note">
            You deleted these steps from the design, but their code is still in the project. Your AI builder removes it the
            next time it syncs (in Claude Code, type <code>/mcp__flowcommit__sync</code>).
          </p>
          <ul className="drift-list">
            {state.removed.map((r) => (
              <li key={r.id}>
                <span className="drift-step is-removed">{r.title}</span>
                {r.files.map((f) => (
                  <code key={f}>{f}</code>
                ))}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="inspector-section">
        <h3 className="dialog-subtitle">Update the flowchart from the code</h3>
        {running ? (
          <div className="ai-status">
            <span className="ai-pulse" aria-hidden="true">
              <Icon name="sparkle" size={14} />
            </span>
            {active?.label} is reading {running.whole ? "the whole project" : "the changed code"}…
            <button type="button" className="button-quiet" onClick={() => running.controller.abort()}>
              Cancel
            </button>
          </div>
        ) : (
          <>
            <p className="inspector-note">
              {state.drift.length
                ? "Reads only the code that changed outside a build."
                : "Reads the project's code and suggests what the flowchart is missing. This can take a few minutes."}{" "}
              {active ? `Uses ${active.label}, which can read but not change your files.` : "Install Claude Code or Codex CLI to use this."}
            </p>
            <button type="button" className="button" disabled={!active} onClick={() => void analyze(!state.drift.length)}>
              <Icon name="sparkle" size={14} /> {state.drift.length ? "Suggest changes from edited code" : "Check the code for differences"}
            </button>
          </>
        )}
        {error && (
          <p className="inspector-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </aside>
  );
}
