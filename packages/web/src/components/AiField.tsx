import { useEffect, useId, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import type { WriteAction, WriteField, WriteRequest } from "@flowcommit/shared";
import { api } from "../api.ts";
import { useAi } from "../ai.tsx";
import { Icon } from "../icons.tsx";
import { useToast } from "./Toasts.tsx";
import { WordDiff } from "./ChangeDetails.tsx";

type Props = {
  field: WriteField;
  label: string;
  value: string;
  onChange: (value: string) => void;
  context: WriteRequest["context"];
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
  hint?: string;
  autoFocusKey?: number;
  onPaste?: (e: ClipboardEvent) => void;
};

type Run =
  | { status: "idle" }
  | { status: "running"; action: WriteAction; startedAt: number; controller: AbortController }
  | { status: "suggestion"; action: WriteAction; instruction: string; text: string }
  | { status: "failed"; message: string };

const ACTIONS: Record<WriteField, { action: WriteAction; label: string; whenEmpty?: boolean }[]> = {
  instructions: [
    { action: "write", label: "Write it for me", whenEmpty: true },
    { action: "clarify", label: "Make it clear for the AI builder" },
    { action: "shorten", label: "Make it shorter" },
    { action: "grammar", label: "Fix spelling and grammar" },
  ],
  title: [
    { action: "write", label: "Suggest a title", whenEmpty: true },
    { action: "clarify", label: "Make it clearer" },
    { action: "grammar", label: "Fix spelling and grammar" },
  ],
  description: [
    { action: "write", label: "Write it for me", whenEmpty: true },
    { action: "clarify", label: "Make it clearer" },
    { action: "shorten", label: "Make it shorter" },
    { action: "grammar", label: "Fix spelling and grammar" },
  ],
  caption: [
    { action: "write", label: "Write a caption", whenEmpty: true },
    { action: "clarify", label: "Make it clearer" },
    { action: "grammar", label: "Fix spelling and grammar" },
  ],
};

/** A text field with an AI button that rewrites its text through the user's own AI CLI. */
export function AiField(props: Props) {
  const { field, label, value, onChange, context, multiline, rows = 6, placeholder, hint } = props;
  const { active } = useAi();
  const notify = useToast();
  const id = useId();
  const inputRef = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [custom, setCustom] = useState("");
  const [run, setRun] = useState<Run>({ status: "idle" });
  const [elapsed, setElapsed] = useState(0);
  // Small fixes are easiest to check as marked-up changes; rewrites read better as plain new text.
  const [showChanges, setShowChanges] = useState(false);

  useEffect(() => {
    if (props.autoFocusKey) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [props.autoFocusKey]);

  useEffect(() => {
    if (run.status !== "running") return;
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - run.startedAt) / 1000)), 500);
    return () => clearInterval(timer);
  }, [run]);

  // Stop a running request if the field goes away, e.g. the user selects another step.
  useEffect(() => () => (run.status === "running" ? run.controller.abort() : undefined), [run]);

  const start = async (action: WriteAction, instruction = "") => {
    if (!active) return;
    setMenuOpen(false);
    const controller = new AbortController();
    setElapsed(0);
    setRun({ status: "running", action, startedAt: Date.now(), controller });
    try {
      const { text } = await api.aiWrite(
        { provider: active.id, field, action, text: value, instruction, context },
        controller.signal,
      );
      setShowChanges(action === "grammar" || action === "shorten");
      setRun({ status: "suggestion", action, instruction, text });
    } catch (err) {
      if ((err as Error).name === "AbortError") setRun({ status: "idle" });
      else setRun({ status: "failed", message: (err as Error).message });
    }
  };

  const accept = (text: string) => {
    const previous = value;
    onChange(text);
    setRun({ status: "idle" });
    setCustom("");
    notify("AI suggestion applied", { action: { label: "Undo", run: () => onChange(previous) } });
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
      e.preventDefault();
      if (active) setMenuOpen((o) => !o);
    }
  };

  const busy = run.status === "running";
  // An empty field can only be written from scratch; a filled one can only be improved.
  const actions = ACTIONS[field].filter((a) => (value.trim() ? !a.whenEmpty : a.whenEmpty));

  return (
    <div className="ai-field" data-busy={busy || undefined}>
      <div className="ai-field-head">
        <label htmlFor={id}>{label}</label>
        <div className="ai-anchor">
          <button
            type="button"
            className="ai-button"
            aria-expanded={menuOpen}
            disabled={!active || busy}
            title={active ? `Write with ${active.label} (⌘J)` : "Install Claude Code or Codex CLI to get AI writing help"}
            onClick={() => setMenuOpen((o) => !o)}
          >
            <Icon name="sparkle" size={14} />
            <span>AI</span>
          </button>
          {menuOpen && active && (
            <AiMenu
              providerLabel={active.label}
              actions={actions}
              custom={custom}
              onCustomChange={setCustom}
              onPick={(a) => void start(a)}
              onCustom={() => custom.trim() && void start("custom", custom.trim())}
              onClose={() => setMenuOpen(false)}
            />
          )}
        </div>
      </div>

      {multiline ? (
        <textarea
          id={id}
          ref={inputRef}
          rows={rows}
          value={value}
          placeholder={placeholder}
          readOnly={busy}
          onChange={(e) => onChange(e.target.value)}
          onPaste={props.onPaste}
          onKeyDown={onKeyDown}
        />
      ) : (
        <input
          id={id}
          ref={inputRef}
          value={value}
          placeholder={placeholder}
          readOnly={busy}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
        />
      )}
      {hint && run.status === "idle" && <small className="field-hint">{hint}</small>}

      {run.status === "running" && (
        <div className="ai-status">
          <span className="ai-pulse" aria-hidden="true">
            <Icon name="sparkle" size={14} />
          </span>
          <span>
            {active?.label} is writing… {elapsed > 0 && <span className="ai-elapsed">{elapsed}s</span>}
          </span>
          <button type="button" className="button-quiet" onClick={() => run.controller.abort()}>
            Cancel
          </button>
        </div>
      )}

      {run.status === "failed" && (
        <div className="ai-status is-failed" role="alert">
          <span>{run.message}</span>
          <button type="button" className="button-quiet" onClick={() => setRun({ status: "idle" })}>
            Dismiss
          </button>
        </div>
      )}

      {run.status === "suggestion" && (
        <div className="ai-suggestion">
          <div className="ai-suggestion-head">
            <Icon name="sparkle" size={14} /> Suggested by {active?.label}
            {value.trim() && (
              <span className="segmented" role="group" aria-label="Show">
                <button type="button" aria-pressed={!showChanges} onClick={() => setShowChanges(false)}>
                  New text
                </button>
                <button type="button" aria-pressed={showChanges} onClick={() => setShowChanges(true)}>
                  Changes
                </button>
              </span>
            )}
          </div>
          {value.trim() && showChanges ? (
            <WordDiff before={value} after={run.text} />
          ) : (
            <p className="word-diff">{run.text}</p>
          )}
          <div className="confirm-actions">
            <button type="button" className="button-primary" onClick={() => accept(run.text)}>
              Use this
            </button>
            <button type="button" className="button" onClick={() => void start(run.action, run.instruction)}>
              Try again
            </button>
            <button type="button" className="button-quiet" onClick={() => setRun({ status: "idle" })}>
              Discard
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function AiMenu(props: {
  providerLabel: string;
  actions: { action: WriteAction; label: string }[];
  custom: string;
  onCustomChange: (v: string) => void;
  onPick: (a: WriteAction) => void;
  onCustom: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.parentElement?.contains(e.target as Node)) props.onClose();
    };
    const onKey = (e: globalThis.KeyboardEvent) => e.key === "Escape" && props.onClose();
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    ref.current?.querySelector("button")?.focus();
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div className="ai-menu" ref={ref} role="menu">
      {props.actions.map((a) => (
        <button key={a.action} type="button" role="menuitem" onClick={() => props.onPick(a.action)}>
          {a.label}
        </button>
      ))}
      <form
        className="ai-menu-custom"
        onSubmit={(e) => {
          e.preventDefault();
          props.onCustom();
        }}
      >
        <input
          value={props.custom}
          placeholder="Or say what to change…"
          aria-label="Tell the AI what to change"
          onChange={(e) => props.onCustomChange(e.target.value)}
        />
        <button type="submit" className="button-primary" disabled={!props.custom.trim()}>
          Go
        </button>
      </form>
      <p className="ai-menu-foot">Uses {props.providerLabel} on this computer</p>
    </div>
  );
}
