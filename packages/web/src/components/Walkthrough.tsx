import { useEffect } from "react";
import { NODE_KIND_INFO } from "@flowcommit/shared";
import type { ArrowEdge, StepNode } from "../model.ts";
import { Icon } from "../icons.tsx";

type Props = {
  current: StepNode;
  nodes: StepNode[];
  edges: ArrowEdge[];
  numbers: Map<string, number>;
  canGoBack: boolean;
  onGo: (id: string) => void;
  onBack: () => void;
  onRestart: () => void;
  onExit: () => void;
};

/**
 * A guided tour of the flow, one step at a time. At a decision you choose which branch to
 * follow. It's the easiest way to explain the app to someone, or to check the flow makes sense.
 */
export function Walkthrough({ current, nodes, edges, numbers, canGoBack, onGo, onBack, onRestart, onExit }: Props) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const next = edges
    .filter((e) => e.source === current.id)
    .map((e) => ({ edge: e, node: byId.get(e.target)! }))
    .filter((x) => x.node)
    .sort((a, b) => a.node.position.x - b.node.position.x);
  const { kind, title, instructions } = current.data;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "Escape") onExit();
      else if (e.key === "ArrowLeft" && canGoBack) onBack();
      else if ((e.key === "ArrowRight" || e.key === "Enter") && next.length === 1) onGo(next[0].node.id);
      else if (/^[1-9]$/.test(e.key) && next[Number(e.key) - 1]) onGo(next[Number(e.key) - 1].node.id);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, canGoBack, onGo, onBack, onExit]);

  return (
    <section className="walkthrough" aria-label="Walk through the flow" aria-live="polite">
      <header className="walkthrough-head">
        <span className="walkthrough-count">
          Step {numbers.get(current.id)} of {nodes.length}
        </span>
        <button type="button" className="icon-button" aria-label="End the walkthrough" onClick={onExit}>
          <Icon name="close" size={14} />
        </button>
      </header>

      <div className="walkthrough-step" data-kind={kind}>
        <span className="step-icon">
          <Icon name={kind} size={16} />
        </span>
        <div>
          <p className="walkthrough-kind">{NODE_KIND_INFO[kind].label}</p>
          <h2 className="walkthrough-title">{title || "Untitled step"}</h2>
        </div>
      </div>
      {instructions && <p className="walkthrough-text">{instructions}</p>}

      <footer className="walkthrough-actions">
        <button type="button" className="button-quiet" onClick={onBack} disabled={!canGoBack}>
          Back
        </button>
        <div className="walkthrough-next">
          {next.length === 0 ? (
            <>
              <span className="inspector-note">This is where the flow ends.</span>
              <button type="button" className="button-primary" onClick={onRestart}>
                Start over
              </button>
            </>
          ) : next.length === 1 ? (
            <button type="button" className="button-primary" onClick={() => onGo(next[0].node.id)}>
              {next[0].edge.data?.label ? `${next[0].edge.data.label}: ` : "Next: "}
              {next[0].node.data.title || "Untitled step"}
            </button>
          ) : (
            <>
              {kind === "decision" && <span className="inspector-note">Choose a path</span>}
              {next.map((x, i) => (
                <button key={x.edge.id} type="button" className="button walkthrough-branch" onClick={() => onGo(x.node.id)}>
                  <kbd>{i + 1}</kbd>
                  {x.edge.data?.label ? `${x.edge.data.label}: ` : ""}
                  {x.node.data.title || "Untitled step"}
                </button>
              ))}
            </>
          )}
        </div>
      </footer>
    </section>
  );
}
