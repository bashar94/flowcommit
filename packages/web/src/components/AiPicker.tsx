import { useEffect, useRef, useState } from "react";
import { useAi } from "../ai.tsx";
import { Icon } from "../icons.tsx";

/** Shows which AI tool FlowCommit is using and lets the user switch between the ones installed. */
export function AiPicker() {
  const { providers, active, choose, refresh } = useAi();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="ai-picker" ref={ref}>
      <button
        type="button"
        className="ai-chip"
        data-connected={active ? true : undefined}
        aria-expanded={open}
        onClick={() => {
          if (!open) refresh();
          setOpen((o) => !o);
        }}
      >
        <span className="ai-chip-dot" aria-hidden="true" />
        <Icon name="sparkle" size={14} />
        <span>{active ? active.label : "Connect AI"}</span>
        <Icon name="chevron" size={14} />
      </button>

      {open && (
        <div className="popover ai-popover">
          <p className="popover-title">AI writing help</p>
          <p className="inspector-note">
            FlowCommit uses an AI tool already installed on this computer. The text you ask about is sent to that
            tool's AI service with your own account, the same as when you use it in the terminal.
          </p>
          <ul className="provider-list">
            {providers.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className="provider"
                  aria-pressed={active?.id === p.id}
                  disabled={!p.available}
                  onClick={() => {
                    choose(p.id);
                    setOpen(false);
                  }}
                >
                  <span className="provider-radio" aria-hidden="true" />
                  <span className="provider-name">{p.label}</span>
                  <span className="provider-meta">{p.available ? p.version : "Not installed"}</span>
                </button>
                {!p.available && (
                  <a className="provider-install" href={p.install} target="_blank" rel="noreferrer">
                    How to install
                  </a>
                )}
              </li>
            ))}
          </ul>
          {providers.length === 0 && <p className="inspector-note">Checking which AI tools are installed…</p>}
        </div>
      )}
    </div>
  );
}
