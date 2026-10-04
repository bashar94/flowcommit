import { useMemo, type MouseEvent } from "react";
import { summarizeDiff, type DiffStats } from "@flowcommit/shared";
import type { Branch, Graph, GraphCommit, HistoryState } from "../api.ts";
import { layoutGraph } from "../graph.ts";
import { shortSha } from "../compare.ts";
import { timeAgo } from "../time.ts";
import { Icon } from "../icons.tsx";

const ROW = 58;
const LANE = 16;
const PAD = 14;
const MAX_LANES = 6;
const LANE_COLORS = ["#3a4ee0", "#16a34a", "#e8900c", "#db2777", "#0891b2", "#8b5cf6"];

type Props = {
  state: HistoryState;
  graph: Graph;
  draftStats: DiffStats | null;
  target: string;
  base: string;
  onSelect: (sha: string) => void;
  onSelectBase: (sha: string) => void;
  onSelectDraft: () => void;
  onReview: (branch: string) => void;
  onTurnOn: () => void;
};

const STATE_HELP: Partial<Record<HistoryState, string>> = {
  "no-git": "Version history uses Git, which isn't installed on this computer. Install Git, then restart FlowCommit.",
  ignored: "This folder is inside a Git repository whose .gitignore ignores .flowcommit. Remove that rule to save versions.",
};

type Row = (GraphCommit & { draft?: false }) | { sha: "draft"; parents: string[]; draft: true };

/**
 * The design's history as a branch graph: every commit that changed the flow, on every branch,
 * newest first. Each branch is a colored lane; tags show where each branch is now.
 */
export function CommitGraph(props: Props) {
  const { graph, draftStats } = props;

  const rows: Row[] = useMemo(() => {
    const commits: Row[] = graph.commits.map((c) => ({ ...c, draft: false as const }));
    return draftStats ? [{ sha: "draft", parents: graph.current.tip ? [graph.current.tip] : [], draft: true }, ...commits] : commits;
  }, [graph, draftStats]);

  const { placed, lines, lanes } = useMemo(() => layoutGraph(rows), [rows]);
  const tags = useMemo(() => {
    const map = new Map<string, Branch[]>();
    for (const b of graph.branches) if (b.tip) map.set(b.tip, [...(map.get(b.tip) ?? []), b]);
    return map;
  }, [graph.branches]);

  const shownLanes = Math.min(lanes, MAX_LANES);
  const x = (lane: number) => PAD + Math.min(lane, MAX_LANES - 1) * LANE;
  const y = (row: number) => row * ROW + ROW / 2;
  const width = PAD * 2 + (shownLanes - 1) * LANE;
  const color = (lane: number) => LANE_COLORS[lane % LANE_COLORS.length];

  const localBranches = graph.branches.filter((b) => !b.remote);
  const localNames = new Set(localBranches.map((b) => b.name));
  const remoteOnly = graph.branches.filter((b) => b.remote && !localNames.has(b.name.replace(/^[^/]+\//, "")));

  const click = (e: MouseEvent, sha: string) => (e.shiftKey || e.altKey ? props.onSelectBase(sha) : props.onSelect(sha));

  return (
    <nav className="timeline graph panel" aria-label="History">
      <div className="graph-head">
        <h2 className="inspector-title">History</h2>
        {graph.current.branch && (
          <span className="branch-chip is-current" title="The branch you're on">
            <Icon name="branch" size={12} />
            {graph.current.branch}
          </span>
        )}
      </div>

      {props.state === "not-repo" && (
        <div className="timeline-empty">
          <p>Version history isn't on for this folder yet. Turning it on lets you save versions and compare them.</p>
          <button type="button" className="button" onClick={props.onTurnOn}>
            Turn on version history
          </button>
        </div>
      )}
      {STATE_HELP[props.state] && <p className="timeline-empty">{STATE_HELP[props.state]}</p>}

      {(localBranches.length > 1 || remoteOnly.length > 0) && (
        <details className="branch-list" open>
          <summary>
            Branches <span className="count">{localBranches.length + remoteOnly.length}</span>
          </summary>
          <ul>
            {[...localBranches, ...remoteOnly].map((b) => (
              <li key={b.name}>
                <span className="branch-name" data-current={b.current || undefined}>
                  <Icon name="branch" size={12} />
                  {b.name}
                </span>
                {b.name !== graph.defaultBranch && b.tip && (
                  <button type="button" className="button-quiet" onClick={() => props.onReview(b.name)}>
                    Review changes
                  </button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      {rows.length === 0 ? (
        props.state === "ready" && <p className="timeline-empty">No versions yet. Use Save version to save your first one.</p>
      ) : (
        <>
          <p className="graph-hint">
            Click a commit to see what it changed. Shift-click another commit to compare from there instead.
          </p>
          <div className="graph-body" style={{ ["--graph-width" as string]: `${width}px` }}>
            <svg className="graph-lines" width={width} height={rows.length * ROW} aria-hidden="true">
              {lines.map((l, i) => {
                const x1 = x(l.from.lane);
                const y1 = y(l.from.row);
                const x2 = x(l.to.lane);
                const y2 = y(l.to.row);
                // A branch's line runs down its own lane and bends into its parent's lane near the parent;
                // a merge bends right away from the merge commit into the merged branch's lane.
                const d =
                  x1 === x2
                    ? `M ${x1} ${y1} L ${x2} ${y2}`
                    : l.merge
                      ? `M ${x1} ${y1} C ${x1} ${y1 + ROW * 0.5}, ${x2} ${y1 + ROW * 0.3}, ${x2} ${y1 + ROW * 0.8} L ${x2} ${y2}`
                      : `M ${x1} ${y1} L ${x1} ${y2 - ROW * 0.8} C ${x1} ${y2 - ROW * 0.3}, ${x2} ${y2 - ROW * 0.5}, ${x2} ${y2}`;
                const lineColor = color(l.merge ? l.to.lane : l.from.lane);
                return (
                  <path
                    key={i}
                    d={d}
                    fill="none"
                    stroke={lineColor}
                    strokeWidth={2.5}
                    strokeDasharray={l.from.row === 0 && rows[0].sha === "draft" ? "4 4" : undefined}
                  />
                );
              })}
              {placed.map((c) => (
                <circle
                  key={c.sha}
                  cx={x(c.lane)}
                  cy={y(c.row)}
                  r={c.sha === props.target ? 7 : 5.5}
                  fill={c.sha === "draft" ? "var(--surface)" : color(c.lane)}
                  stroke={c.sha === "draft" ? color(c.lane) : "var(--surface)"}
                  strokeWidth={c.sha === "draft" ? 2.5 : 2}
                  strokeDasharray={c.sha === "draft" ? "3 2" : undefined}
                />
              ))}
            </svg>

            <ol className="graph-rows">
              {placed.map((c) => {
                if (c.draft) {
                  return (
                    <li key="draft" style={{ height: ROW }}>
                      <button
                        type="button"
                        className="graph-row is-draft"
                        aria-current={props.target === "draft" || undefined}
                        onClick={props.onSelectDraft}
                      >
                        <span className="graph-title">Unsaved changes</span>
                        <span className="graph-meta">{draftStats ? summarizeDiff(draftStats) : ""}</span>
                      </button>
                    </li>
                  );
                }
                const commit = c as GraphCommit & { lane: number };
                const branchTags = tags.get(commit.sha) ?? [];
                return (
                  <li key={commit.sha} style={{ height: ROW }}>
                    <button
                      type="button"
                      className="graph-row"
                      aria-current={props.target === commit.sha || undefined}
                      data-base={props.base === commit.sha || undefined}
                      title={commit.stats ? summarizeDiff(commit.stats) : undefined}
                      onClick={(e) => click(e, commit.sha)}
                    >
                      <span className="graph-title">{commit.message}</span>
                      <span className="graph-meta">
                        {commit.author}, <time dateTime={commit.date}>{timeAgo(commit.date)}</time>
                        <code>{shortSha(commit.sha)}</code>
                      </span>
                      {branchTags.length > 0 && (
                        <span className="graph-tags">
                          {branchTags.map((b) => (
                            <span
                              key={b.name}
                              className="branch-chip"
                              data-remote={b.remote || undefined}
                              data-current={b.current || undefined}
                              style={{ ["--lane" as string]: color(commit.lane) }}
                            >
                              {b.current && <Icon name="check" size={10} />}
                              {b.name}
                            </span>
                          ))}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>
        </>
      )}
    </nav>
  );
}
