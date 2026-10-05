import { useEffect, useRef, useState } from "react";
import { suggestMessage, summarizeDiff, type FlowDiff } from "@flowcommit/shared";
import { api, type HistoryState } from "../api.ts";

type Props = {
  state: HistoryState;
  flowName: string;
  diff: FlowDiff;
  nextNumber: number;
  onSave: (message: string, withCode: boolean) => Promise<void>;
  onClose: () => void;
};

/** Names the version and saves it. A blank message uses one written from the changes. */
export function SaveVersionDialog({ state, flowName, diff, nextNumber, onSave, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Code changed since the last commit, usually by the AI building this design.
  const [codeFiles, setCodeFiles] = useState<string[]>([]);
  const [withCode, setWithCode] = useState(true);
  const suggestion = suggestMessage(diff, flowName);
  const blocked = state === "no-git" || state === "ignored";

  useEffect(() => {
    ref.current?.showModal();
    if (state === "ready") api.codeChanges().then((r) => setCodeFiles(r.files)).catch(() => {});
  }, [state]);

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      await onSave(message.trim() || suggestion, withCode && codeFiles.length > 0);
    } catch (err) {
      setError((err as Error).message);
    } finally {
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

        {!blocked && codeFiles.length > 0 && (
          <label className="check setup-check">
            <input type="checkbox" checked={withCode} onChange={(e) => setWithCode(e.target.checked)} />
            <span>
              <strong>
                Include my code changes ({codeFiles.length} {codeFiles.length === 1 ? "file" : "files"})
              </strong>
              . This version then holds the design and the code that builds it, so you can go back to both together.
              <span className="save-code-files">
                {codeFiles.slice(0, 6).map((f) => (
                  <code key={f}>{f}</code>
                ))}
                {codeFiles.length > 6 && <span>and {codeFiles.length - 6} more</span>}
              </span>
            </span>
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
