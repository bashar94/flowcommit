import { useEffect, useRef, useState } from "react";
import { suggestMessage, summarizeDiff, type FlowDiff } from "@flowcommit/shared";
import type { HistoryState } from "../api.ts";

type Props = {
  state: HistoryState;
  flowName: string;
  diff: FlowDiff;
  nextNumber: number;
  onSave: (message: string) => Promise<void>;
  onClose: () => void;
};

/** Names the version and saves it. A blank message uses one written from the changes. */
export function SaveVersionDialog({ state, flowName, diff, nextNumber, onSave, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const suggestion = suggestMessage(diff, flowName);
  const blocked = state === "no-git" || state === "ignored";

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      await onSave(message.trim() || suggestion);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby="save-version-title"
      onClose={onClose}
      onCancel={(e) => busy && e.preventDefault()}
    >
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h2 id="save-version-title" className="inspector-title">
          Save Version {nextNumber}
        </h2>
        <p className="inspector-note">{summarizeDiff(diff.stats)}</p>

        {blocked ? (
          <p className="inspector-error">
            {state === "no-git"
              ? "Version history uses Git, which isn't installed on this computer."
              : "This folder's .gitignore ignores .flowcommit, so versions can't be saved."}
          </p>
        ) : (
          <label className="field">
            <span>What changed?</span>
            <input
              autoFocus
              value={message}
              placeholder={suggestion}
              maxLength={200}
              onChange={(e) => setMessage(e.target.value)}
            />
            <small>Leave it blank to use the suggestion.</small>
          </label>
        )}

        {state === "not-repo" && (
          <p className="inspector-note">This turns on version history for this folder. It uses Git, like regular code.</p>
        )}
        {error && (
          <p className="inspector-error" role="alert">
            {error}
          </p>
        )}

        <div className="confirm-actions">
          {!blocked && (
            <button type="submit" className="button-primary" disabled={busy}>
              {busy ? "Saving…" : `Save Version ${nextNumber}`}
            </button>
          )}
          <button type="button" className="button-quiet" onClick={() => ref.current?.close()} disabled={busy}>
            Cancel
          </button>
        </div>
      </form>
    </dialog>
  );
}
