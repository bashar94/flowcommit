import { useEffect, useRef, useState } from "react";
import { NODE_KIND_INFO, type PlannedStep } from "@flowcommit/shared";
import { api, type BuildInfo } from "../api.ts";
import { BUILD_LABEL } from "../build.tsx";
import { Icon } from "../icons.tsx";

type Props = {
  info: BuildInfo | null;
  plan: PlannedStep[];
  onConnected: () => void;
  onSelectStep: (id: string) => void;
  onClose: () => void;
};

const BUILD_PROMPT = "Build my app from the FlowCommit flow";
const SYNC_PROMPT = "Sync the code with the FlowCommit flow";

/** Shows build progress and how to connect Claude Code or Codex so they can build the flow. */
export function BuildDialog({ info, plan, onConnected, onSelectStep, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [tool, setTool] = useState<"claude" | "codex">("claude");
  const [busy, setBusy] = useState(false);
  const [withHook, setWithHook] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const built = plan.filter((p) => p.view === "built").length;
  const percent = plan.length ? Math.round((built / plan.length) * 100) : 0;
  const folder = info?.projectPath ?? "";

  const connect = async () => {
    setBusy(true);
    setError("");
    try {
      await api.connectClaude({ hook: withHook });
      onConnected();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog ref={ref} className="dialog build-dialog" aria-labelledby="build-title" onClose={onClose}>
      <div className="build-body">
        <header className="build-header">
          <div>
            <h2 id="build-title" className="dialog-title">
              Build with AI
            </h2>
            <p className="inspector-note">
              An AI coding agent reads your flow through FlowCommit and builds it one step at a time. Each card lights
              up as it works.
            </p>
          </div>
          <button type="button" className="icon-button" aria-label="Close" onClick={() => ref.current?.close()}>
            <Icon name="close" />
          </button>
        </header>

        <div className="progress" aria-label={`${built} of ${plan.length} steps built`}>
          <div className="progress-bar">
            <span style={{ width: `${percent}%` }} />
          </div>
          <span className="progress-text">
            {built} of {plan.length} steps built
          </span>
        </div>

        <section className="build-section-block">
          <div className="segmented segmented-large" role="tablist" aria-label="AI tool">
            <button type="button" role="tab" aria-pressed={tool === "claude"} onClick={() => setTool("claude")}>
              Claude Code
            </button>
            <button type="button" role="tab" aria-pressed={tool === "codex"} onClick={() => setTool("codex")}>
              Codex CLI
            </button>
          </div>

          {tool === "claude" ? (
            <ol className="build-steps">
              <li>
                <span className="build-step-title">Add FlowCommit to this project</span>
                {info?.claudeConnected && (info.claudeHook || !withHook) ? (
                  <span className="build-done">
                    <Icon name="check" size={14} /> Added to <code>.mcp.json</code>
                    {info.claudeHook && (
                      <>
                        {" "}
                        and <code>.claude/settings.json</code>
                      </>
                    )}
                  </span>
                ) : (
                  <>
                    <span className="inspector-note">
                      This adds a <code>.mcp.json</code> file to your project so Claude Code can find FlowCommit. Claude
                      Code asks you to approve it the first time.
                    </span>
                    <label className="check setup-check">
                      <input type="checkbox" checked={withHook} onChange={(e) => setWithHook(e.target.checked)} />
                      <span>
                        <strong>Keep Claude in sync automatically.</strong> At the start of each message, Claude is told what
                        changed in the design, so you never have to remind it. (Adds a hook to <code>.claude/settings.json</code>.)
                      </span>
                    </label>
                    <button type="button" className="button-primary" onClick={connect} disabled={busy || !info}>
                      {busy ? "Adding…" : "Add to project"}
                    </button>
                  </>
                )}
              </li>
              <li>
                <span className="build-step-title">Start Claude Code in your project folder</span>
                <Command text={`cd ${shellQuote(folder)} && claude`} />
              </li>
              <li>
                <span className="build-step-title">Ask it to build</span>
                <Command text={BUILD_PROMPT} />
                <span className="inspector-note">
                  Or type <code>/mcp__flowcommit__build</code>. Later, after changing the design, type{" "}
                  <code>/mcp__flowcommit__sync</code> or just ask: "{SYNC_PROMPT}". You approve its code changes in the
                  terminal, as usual.
                </span>
              </li>
            </ol>
          ) : (
            <ol className="build-steps">
              <li>
                <span className="build-step-title">Add FlowCommit to Codex</span>
                <span className="inspector-note">Run this once in a terminal. It adds FlowCommit to your Codex settings.</span>
                <Command text={info?.commands.codex ?? ""} />
              </li>
              <li>
                <span className="build-step-title">Tell Codex to keep the flow in sync</span>
                {info?.agentsInstructions ? (
                  <span className="build-done">
                    <Icon name="check" size={14} /> Instructions added to <code>AGENTS.md</code>
                  </span>
                ) : (
                  <>
                    <span className="inspector-note">
                      Adds a short FlowCommit section to <code>AGENTS.md</code>, which Codex, Cursor and other agents read
                      before every task. It tells them to check for design changes and suggest flow updates.
                    </span>
                    <button
                      type="button"
                      className="button"
                      disabled={busy || !info}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await api.connectAgents();
                          onConnected();
                        } catch (err) {
                          setError((err as Error).message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Add to AGENTS.md
                    </button>
                  </>
                )}
              </li>
              <li>
                <span className="build-step-title">Start Codex in your project folder and ask it to build</span>
                <Command text={`cd ${shellQuote(folder)} && codex "${BUILD_PROMPT}"`} />
              </li>
            </ol>
          )}
          {error && (
            <p className="inspector-error" role="alert">
              {error}
            </p>
          )}
        </section>

        <section className="build-section-block">
          <h3 className="dialog-subtitle">Steps</h3>
          {plan.length === 0 ? (
            <p className="inspector-note">Add some steps to your flow first.</p>
          ) : (
            <ul className="build-list">
              {plan.map((p) => (
                <li key={p.node.id}>
                  <button
                    type="button"
                    className="build-row"
                    data-build={p.view}
                    onClick={() => {
                      onSelectStep(p.node.id);
                      ref.current?.close();
                    }}
                  >
                    <span className="build-row-icon" data-kind={p.node.kind}>
                      <Icon name={p.node.kind} size={13} />
                    </span>
                    <span className="build-row-title">
                      {p.node.title || "Untitled step"}
                      <span className="build-row-kind">{NODE_KIND_INFO[p.node.kind].label}</span>
                    </span>
                    <span className="build-chip">{BUILD_LABEL[p.view]}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </dialog>
  );
}

function shellQuote(s: string) {
  return /^[\w./-]+$/.test(s) ? s : `'${s.replaceAll("'", `'\\''`)}'`;
}

function Command({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="command">
      <code>{text}</code>
      <button
        type="button"
        className="button-quiet"
        onClick={() => {
          void navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        <Icon name={copied ? "check" : "copy"} size={14} />
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
