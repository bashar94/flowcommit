import { useEffect, useMemo, useRef, useState } from "react";
import { NODE_KIND_INFO } from "@flowcommit/shared";
import type { StepNode } from "../model.ts";
import { Icon } from "../icons.tsx";

type Props = {
  nodes: StepNode[];
  numbers: Map<string, number>;
  onMatches: (ids: Set<string> | null) => void;
  onPick: (id: string) => void;
  onClose: () => void;
};

/**
 * Finds steps by title, instructions, tags, type, or what they use in the code (like "Stripe" or
 * "/api/checkout"). Matches light up on the canvas as you type.
 */
export function SearchBox({ nodes, numbers, onMatches, onPick, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => input.current?.focus(), []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return nodes
      .map((n) => {
        const d = n.data;
        const title = d.title.toLowerCase();
        const score = title.startsWith(q)
          ? 0
          : title.includes(q)
            ? 1
            : [...d.tags, ...(d.uses ?? []), d.codeRef ?? ""].some((t) => t.toLowerCase().includes(q))
              ? 2
              : NODE_KIND_INFO[d.kind].label.toLowerCase().includes(q)
                ? 3
                : d.instructions.toLowerCase().includes(q)
                  ? 4
                  : -1;
        return { node: n, score };
      })
      .filter((r) => r.score >= 0)
      .sort((a, b) => a.score - b.score || (numbers.get(a.node.id) ?? 0) - (numbers.get(b.node.id) ?? 0));
  }, [query, nodes, numbers]);

  useEffect(() => {
    setActive(0);
    onMatches(query.trim() ? new Set(results.map((r) => r.node.id)) : null);
  }, [results, query, onMatches]);

  useEffect(() => () => onMatches(null), [onMatches]);

  const pick = (id: string) => {
    onPick(id);
    onClose();
  };

  return (
    <div className="search-box" role="search">
      <div className="search-field">
        <Icon name="search" size={15} />
        <input
          ref={input}
          value={query}
          placeholder="Find a step"
          aria-label="Find a step"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            else if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, results.length - 1));
            else if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
            else if (e.key === "Enter" && results[active]) pick(results[active].node.id);
            else return;
            e.preventDefault();
          }}
        />
        <span className="search-count">{query.trim() ? `${results.length} found` : "⌘F"}</span>
      </div>
      {results.length > 0 && (
        <ul className="search-results" role="listbox">
          {results.slice(0, 8).map((r, i) => (
            <li key={r.node.id} role="option" aria-selected={i === active}>
              <button type="button" onMouseEnter={() => setActive(i)} onClick={() => pick(r.node.id)}>
                <span className="outline-num" data-kind={r.node.data.kind}>
                  {numbers.get(r.node.id)}
                </span>
                <span className="search-title">{r.node.data.title || "Untitled step"}</span>
                <span className="search-kind">{NODE_KIND_INFO[r.node.data.kind].label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {query.trim() && results.length === 0 && <p className="search-empty">No steps match "{query.trim()}".</p>}
    </div>
  );
}
