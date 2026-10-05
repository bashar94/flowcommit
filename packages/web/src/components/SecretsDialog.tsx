import { useEffect, useRef, useState } from "react";
import { fixPrompt, type SecretReport } from "@flowcommit/shared";
import { api } from "../api.ts";
import { Icon } from "../icons.tsx";

export type SecretsCheck = {
  context: "save" | "push";
  report: SecretReport & { commits?: number };
  /** Saves again without these code files. */
  leaveOut?: (files: string[]) => Promise<void>;
  /** Saves or pushes even so. */
  anyway: () => Promise<void>;
  /** Runs the check again, after a file was added to .gitignore. */
  recheck: () => Promise<void>;
};

const FLOW_PATH = ".flowcommit/flow.json";

/**
 * Shown when a save or push would store passwords or keys in Git. It says where they are,
 * without showing them, and offers the safe way out first.
 */
export function SecretsDialog({
  check,
  onShowStep,
  onClose,
}: {
  check: SecretsCheck;
  onShowStep: (id: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const { report, context } = check;

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const run = async (label: string, task: () => Promise<void>) => {
    setBusy(label);
    setError("");
    try {
      await task();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const byFile = new Map<string, SecretReport["findings"]>();
  for (const f of report.findings) byFile.set(f.file, [...(byFile.get(f.file) ?? []), f]);
  const codeFiles = [...new Set([...byFile.keys(), ...report.files.map((f) => f.file)])].filter((f) => f !== FLOW_PATH);
  const inDesign = byFile.get(FLOW_PATH) ?? [];
  const prompt = fixPrompt(report, { inHistory: context === "push" });

  return (
    <dialog ref={ref} className="dialog secrets-dialog" aria-labelledby="secrets-title" onClose={onClose}>
      <div className="secrets-body">
        <header className="build-header">
          <div>
            <h2 id="secrets-title" className="dialog-title">
              <span className="secrets-icon" aria-hidden="true">
                <Icon name="alert" size={16} />
              </span>
              Possible passwords or keys
            </h2>
            <p className="inspector-note">
              {context === "push"
                ? `${report.commits && report.commits > 1 ? `The ${report.commits} commits` : "The commit"} you're about to push look like they contain secrets. On GitHub they stay in the history even if you delete them later, and anyone who can see the repository can use them.`
                : "This version looks like it contains secrets. Once saved, they stay in the project's history, and go to GitHub with the next push."}
            </p>
          </div>
          <button type="button" className="icon-button" aria-label="Close" onClick={() => ref.current?.close()}>
            <Icon name="close" />
          </button>
        </header>

        {inDesign.length > 0 && (
          <section className="secrets-group">
            <h3 className="dialog-subtitle">In the design</h3>
            <ul className="secrets-list">
              {inDesign.map((f, i) => (
                <li key={i}>
                  <span className="secrets-what">
                    {f.label} <code>{f.preview}</code>
                  </span>
                  <span className="secrets-where">{f.step ? `in "${f.step.title}"` : `line ${f.line}`}</span>
                  {f.step?.id && (
                    <button
                      type="button"
                      className="button-quiet"
                      onClick={() => {
                        onShowStep(f.step!.id);
                        ref.current?.close();
                      }}
                    >
                      Show step
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <p className="inspector-note">
              Instructions are read by AI tools and saved in Git, so they're no place for a real key. Write "use the
              Stripe key from the environment" instead.
            </p>
          </section>
        )}

        {codeFiles.length > 0 && (
          <section className="secrets-group">
            <h3 className="dialog-subtitle">In the code</h3>
            <ul className="secrets-list">
              {codeFiles.map((file) => {
                const risky = report.files.find((f) => f.file === file);
                return (
                  <li key={file} className="secrets-file">
                    <code className="secrets-path">{file}</code>
                    {risky && <span className="secrets-where">{risky.reason}</span>}
                    {(byFile.get(file) ?? []).map((f, i) => (
                      <span key={i} className="secrets-what">
                        Line {f.line}: {f.label} <code>{f.preview}</code>
                      </span>
                    ))}
                    {risky && context === "save" && (
                      <button
                        type="button"
                        className="button-quiet"
                        disabled={!!busy}
                        title="The file stays on your computer, but Git stops saving it"
                        onClick={() =>
                          void run(file, async () => {
                            await api.ignoreFile(file);
                            await check.recheck();
                          })
                        }
                      >
                        {busy === file ? "Adding…" : "Keep it out of Git (.gitignore)"}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <section className="secrets-group">
          <h3 className="dialog-subtitle">How to fix it</h3>
          <p className="inspector-note">
            Ask your AI builder to move the secrets into environment variables. This message tells it what to do:
          </p>
          <div className="command secrets-prompt">
            <code>{prompt}</code>
            <button
              type="button"
              className="button-quiet"
              onClick={() => {
                void navigator.clipboard.writeText(prompt).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                });
              }}
            >
              <Icon name={copied ? "check" : "copy"} size={14} />
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          {context === "push" && (
            <p className="inspector-note">If a key was ever pushed before, replace it with a new one from the service it belongs to.</p>
          )}
        </section>

        {error && (
          <p className="inspector-error" role="alert">
            {error}
          </p>
        )}

        <div className="confirm-actions secrets-actions">
          {context === "save" && check.leaveOut && codeFiles.length > 0 && inDesign.length === 0 && (
            <button type="button" className="button-primary" disabled={!!busy} onClick={() => void run("leave", () => check.leaveOut!(codeFiles))}>
              {busy === "leave" ? "Saving…" : `Save without ${codeFiles.length === 1 ? "this file" : "these files"}`}
            </button>
          )}
          <button type="button" className={context === "push" ? "button-primary" : "button"} disabled={!!busy} onClick={() => ref.current?.close()}>
            {context === "push" ? "Don't push" : "Cancel"}
          </button>
          <button type="button" className="button-quiet button-danger" disabled={!!busy} onClick={() => void run("anyway", check.anyway)}>
            {busy === "anyway" ? "Working…" : context === "push" ? "Push anyway" : "Save anyway"}
          </button>
        </div>
      </div>
    </dialog>
  );
}
