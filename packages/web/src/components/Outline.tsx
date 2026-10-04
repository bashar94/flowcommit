import { useMemo } from "react";
import { NODE_KIND_INFO, type NodeKind } from "@flowcommit/shared";
import { outline } from "../flowView.ts";
import type { ArrowEdge, StepNode } from "../model.ts";
import { Icon } from "../icons.tsx";

type Props = {
  nodes: StepNode[];
  edges: ArrowEdge[];
  numbers: Map<string, number>;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
  onWalkThrough: () => void;
};

/**
 * The whole flow as a numbered, indented list. Reading it top to bottom tells the story of
 * the app; each decision's branches are indented under it, and loops say where they go back to.
 */
export function Outline({ nodes, edges, numbers, onSelect, onHover, onWalkThrough }: Props) {
  const items = useMemo(() => outline(nodes, edges, numbers), [nodes, edges, numbers]);
  const byId = new Map(nodes.map((n) => [n.id, n]));

  return (
    <nav className="outline panel" aria-label="Outline of the flow">
      <div className="outline-head">
        <h2 className="inspector-title">Outline</h2>
        <button type="button" className="button" onClick={onWalkThrough} disabled={nodes.length === 0}>
          <Icon name="start" size={12} /> Walk through
        </button>
      </div>
      <ol className="outline-list">
        {items.map((item, i) => {
          const n = byId.get(item.id);
          if (!n) return null;
          const kind = n.data.kind as NodeKind;
          const title = n.data.title || "Untitled step";
          return (
            <li
              key={`${item.id}-${i}`}
              style={{ paddingLeft: item.depth * 18, ["--guide" as string]: `${(item.depth - 1) * 18}px` }}
              data-depth={item.depth}
            >
              <button
                type="button"
                className="outline-row"
                data-goto={item.type === "goto" || undefined}
                onClick={() => onSelect(item.id)}
                onMouseEnter={() => onHover(item.id)}
                onMouseLeave={() => onHover(null)}
              >
                {item.via && <span className="outline-via">{item.via}</span>}
                {item.type === "goto" ? (
                  <span className="outline-goto">
                    {item.back ? "↩ Back to" : "Continues at"} {numbers.get(item.id)}. {title}
                  </span>
                ) : (
                  <>
                    <span className="outline-num" data-kind={kind} title={NODE_KIND_INFO[kind].label}>
                      {numbers.get(item.id)}
                    </span>
                    <span className="outline-title">{title}</span>
                  </>
                )}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
