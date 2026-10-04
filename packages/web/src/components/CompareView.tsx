import { useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  applyNodeChanges,
  useReactFlow,
  type OnNodesChange,
} from "@xyflow/react";
import { diffFlows, type DiffStats, type FlowFile } from "@flowcommit/shared";
import { api, type Graph, type GraphCommit, type HistoryState } from "../api.ts";
import { commitLabel, diffCanvas, shortSha, sideKey, sideLabel, type Side } from "../compare.ts";
import type { ArrowEdge, StepData, StepNode } from "../model.ts";
import { StepCard } from "./StepCard.tsx";
import { CommitGraph } from "./CommitGraph.tsx";
import { timeAgo } from "../time.ts";
import { Icon } from "../icons.tsx";
import { ChangeList, NodeChanges } from "./ChangeDetails.tsx";

const nodeTypes = { step: StepCard };
// Extra room at the top keeps the cards clear of the compare bar.
const FIT_VIEW = { padding: { top: "96px", bottom: "48px", left: "376px", right: "420px" }, maxZoom: 1 } as const;

/** A branch or pull request being reviewed: its changes since it split off from the main branch. */
export type Review = { title: string; base: Side; target: Side; url?: string };

type Props = {
  state: HistoryState;
  graph: Graph;
  draft: FlowFile;
  draftStats: DiffStats | null;
  review: Review | null;
  onReview: (branch: string) => void;
  onTurnOn: () => void;
  onRestore: (sha: string) => Promise<void>;
  onBranch: (sha: string, name: string) => Promise<void>;
};

const commitSide = (c: GraphCommit): Side => ({ kind: "version", sha: c.sha, label: commitLabel(c) });

/** Shows two versions of the flow on one canvas, with what was added, removed and changed. */
export function CompareView({ state, graph, draft, draftStats, review, onReview, onTurnOn, onRestore, onBranch }: Props) {
  const rf = useReactFlow<StepNode, ArrowEdge>();
  const bySha = useMemo(() => new Map(graph.commits.map((c) => [c.sha, c])), [graph.commits]);
  const head = graph.current.tip ? bySha.get(graph.current.tip) : graph.commits[0];

  const sideOf = (sha: string | null | undefined): Side => {
    if (!sha) return { kind: "empty" };
    const c = bySha.get(sha);
    return c ? commitSide(c) : { kind: "version", sha, label: shortSha(sha) };
  };
  /** The commit before this one on its own line of work. */
  const previousOf = (sha: string): Side => sideOf(bySha.get(sha)?.parents[0]);

  const [target, setTarget] = useState<Side>(() =>
    review ? review.target : draftStats || !head ? { kind: "draft" } : commitSide(head),
  );
  const [base, setBase] = useState<Side>(() =>
    review ? review.base : draftStats || !head ? sideOf(head?.sha) : previousOf(head.sha),
  );
  const reviewing = review && sideKey(review.base) === sideKey(base) && sideKey(review.target) === sideKey(target);
  const [pair, setPair] = useState<{ before: FlowFile | null; after: FlowFile } | null>(null);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Saved versions never change, so each one is fetched only once.
  const cache = useRef(new Map<string, FlowFile>());
  const draftRef = useRef(draft);
  draftRef.current = draft;

  useEffect(() => {
    let cancelled = false;
    const load = async (side: Side): Promise<FlowFile | null> => {
      if (side.kind === "empty") return null;
      if (side.kind === "draft") return draftRef.current;
      const hit = cache.current.get(side.sha);
      if (hit) return hit;
      const flow = await api.versionFlow(side.sha);
      cache.current.set(side.sha, flow);
      return flow;
    };
    setError("");
    Promise.all([load(base), load(target)])
      .then(([before, after]) => {
        if (cancelled) return;
        setPair({ before, after: after! });
        setSelectedId(null);
      })
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [base, target]);

  const diff = useMemo(() => (pair ? diffFlows(pair.before, pair.after) : null), [pair]);
  const canvas = useMemo(() => (diff ? diffCanvas(diff, base, target) : { nodes: [], edges: [] }), [diff, base, target]);
  // The canvas reports each card's size back; keeping it lets the minimap draw the cards.
  const [nodes, setNodes] = useState<StepNode[]>([]);
  useEffect(() => {
    setNodes((prev) => {
      const measured = new Map(prev.map((n) => [n.id, n.measured]));
      return canvas.nodes.map((n) => ({ ...n, measured: measured.get(n.id), selected: n.id === selectedId }));
    });
  }, [canvas.nodes, selectedId]);
  const onNodesChange: OnNodesChange<StepNode> = (changes) =>
    setNodes((ns) => applyNodeChanges(changes.filter((c) => c.type === "dimensions"), ns));
  const selectedChange = diff?.nodes.find((n) => n.id === selectedId) ?? null;

  const focus = (id: string) => {
    setSelectedId(id);
    void rf.fitView({ nodes: [{ id }], maxZoom: 1.1, duration: 300, padding: 0.6 });
  };

  const baseOptions: Side[] = [
    ...graph.commits.filter((c) => sideKey(target) !== c.sha).map(commitSide),
    { kind: "empty" },
  ];
  if (base.kind === "version" && !baseOptions.some((o) => sideKey(o) === base.sha)) baseOptions.unshift(base);

  return (
    <>
      <CommitGraph
        state={state}
        graph={graph}
        draftStats={draftStats}
        target={sideKey(target)}
        base={sideKey(base)}
        onTurnOn={onTurnOn}
        onReview={onReview}
        onSelectDraft={() => {
          setTarget({ kind: "draft" });
          setBase(sideOf(head?.sha));
        }}
        onSelect={(sha) => {
          setTarget(sideOf(sha));
          setBase(previousOf(sha));
        }}
        onSelectBase={(sha) => setBase(sideOf(sha))}
      />

      <main className="canvas">
        <div className="compare-bar">
          {reviewing && (
            <span className="review-tag">
              <Icon name="branch" size={13} /> {review.title}
            </span>
          )}
          <label>
            <span>Changes since</span>
            <select
              value={sideKey(base)}
              onChange={(e) => setBase(baseOptions.find((s) => sideKey(s) === e.target.value)!)}
            >
              {baseOptions.map((s) => (
                <option key={sideKey(s)} value={sideKey(s)}>
                  {sideLabel(s)}
                </option>
              ))}
            </select>
          </label>
          <span className="compare-target">in {sideLabel(target)}</span>
          <span className="legend" aria-label="Colors">
            <span data-status="added">Added</span>
            <span data-status="removed">Removed</span>
            <span data-status="changed">Changed</span>
          </span>
        </div>

        {error ? (
          <div className="canvas-message" role="alert">
            <p>{error}</p>
          </div>
        ) : (
          <ReactFlow
            // A fresh canvas per comparison, so it fits the view once the cards have been measured.
            key={pair ? `${sideKey(base)}:${sideKey(target)}` : "loading"}
            fitView
            fitViewOptions={FIT_VIEW}
            nodes={nodes}
            onNodesChange={onNodesChange}
            edges={canvas.edges}
            nodeTypes={nodeTypes}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            deleteKeyCode={null}
            onNodeClick={(_, n) => setSelectedId(n.id)}
            onPaneClick={() => setSelectedId(null)}
            colorMode="system"
            minZoom={0.2}
          >
            <Background id="minor" variant={BackgroundVariant.Lines} gap={24} lineWidth={1} color="var(--grid-minor)" />
            <Background
              id="major"
              variant={BackgroundVariant.Lines}
              gap={120}
              lineWidth={1}
              color="var(--grid-major)"
              bgColor="transparent"
            />
            <Controls showInteractive={false} position="bottom-left" />
            <MiniMap
              position="bottom-left"
              pannable
              zoomable
              nodeClassName={(n) => `minimap-node diff-${(n.data as StepData).diff ?? "none"}`}
            />
          </ReactFlow>
        )}
      </main>

      <aside className="inspector panel" aria-label="Changes">
        {selectedChange ? (
          <>
            <div className="inspector-section">
              <button type="button" className="button-quiet back" onClick={() => setSelectedId(null)}>
                All changes
              </button>
            </div>
            <NodeChanges change={selectedChange} base={base} target={target} />
          </>
        ) : (
          <>
            <VersionHeader
              target={target}
              commit={target.kind === "version" ? bySha.get(target.sha) : undefined}
              webUrl={graph.remote?.webUrl ?? null}
              review={reviewing ? review : null}
              hasDraft={!!draftStats}
              onRestore={onRestore}
              onBranch={onBranch}
            />
            <div className="inspector-section">
              <h2 className="inspector-title">What changed</h2>
              {diff ? <ChangeList diff={diff} onFocus={focus} /> : <p className="inspector-note">Loading…</p>}
            </div>
          </>
        )}
      </aside>
    </>
  );
}

function VersionHeader({
  target,
  commit,
  webUrl,
  review,
  hasDraft,
  onRestore,
  onBranch,
}: {
  target: Side;
  commit?: GraphCommit;
  webUrl: string | null;
  review: Review | null;
  hasDraft: boolean;
  onRestore: (sha: string) => Promise<void>;
  onBranch: (sha: string, name: string) => Promise<void>;
}) {
  const [confirming, setConfirming] = useState<"restore" | "branch" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [branchName, setBranchName] = useState("");
  const [code, setCode] = useState<string[] | null>(null);
  const sha = commit?.sha;

  useEffect(() => {
    setConfirming(null);
    setError("");
    setCode(null);
    if (sha) api.versionCode(sha).then((r) => setCode(r.files)).catch(() => setCode(null));
  }, [target, sha]);

  if (!commit) {
    return (
      <div className="inspector-section">
        <h2 className="inspector-title">Unsaved changes</h2>
        <p className="inspector-note">Your current design. Save a version to keep these changes in history.</p>
      </div>
    );
  }

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  const restore = () => run(() => onRestore(commit.sha));

  return (
    <div className="inspector-section">
      {review && (
        <p className="review-note">
          Reviewing every design change in <strong>{review.title}</strong>, since it split off.
          {review.url && (
            <>
              {" "}
              <a href={review.url} target="_blank" rel="noreferrer">
                Open on GitHub
              </a>
            </>
          )}
        </p>
      )}
      <h2 className="inspector-title">{commit.message}</h2>
      <p className="inspector-note">
        By {commit.author}, <time dateTime={commit.date}>{timeAgo(commit.date)}</time>{" "}
        {webUrl ? (
          <a href={`${webUrl}/commit/${commit.sha}`} target="_blank" rel="noreferrer">
            <code>{shortSha(commit.sha)}</code>
          </a>
        ) : (
          <code>{shortSha(commit.sha)}</code>
        )}
      </p>
      {code && code.length > 0 && (
        <details className="version-code">
          <summary>
            Saved with {code.length} code {code.length === 1 ? "file" : "files"}
          </summary>
          <ul>
            {code.slice(0, 30).map((f) => (
              <li key={f}>
                <code>{f}</code>
              </li>
            ))}
            {code.length > 30 && <li className="inspector-note">and {code.length - 30} more</li>}
          </ul>
        </details>
      )}
      {!confirming ? (
        <div className="branch-actions">
          <button type="button" className="button" onClick={() => setConfirming("restore")}>
            Restore this design
          </button>
          <button type="button" className="button" onClick={() => setConfirming("branch")}>
            <Icon name="branch" size={14} /> Open as a branch
          </button>
        </div>
      ) : confirming === "branch" ? (
        <form
          className="confirm"
          onSubmit={(e) => {
            e.preventDefault();
            if (branchName.trim()) void run(() => onBranch(commit.sha, branchName));
          }}
        >
          <p>
            Starts a new branch from this commit. Your design <strong>and your code</strong> go back to how they were
            here, and new versions are saved on the branch. The branch you're on now stays as it is, so you can switch
            back.
          </p>
          <input
            autoFocus
            value={branchName}
            placeholder="Branch name, like try/old-checkout"
            aria-label="New branch name"
            onChange={(e) => setBranchName(e.target.value)}
          />
          <div className="confirm-actions">
            <button type="submit" className="button-primary" disabled={busy || !branchName.trim()}>
              {busy ? "Opening…" : "Open as a branch"}
            </button>
            <button type="button" className="button-quiet" onClick={() => setConfirming(null)} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="confirm">
          <p>
            Your design will go back to how it was in this commit. Your code stays as it is; to bring the code back too,
            open the version as a branch.
            {hasDraft
              ? " Your unsaved changes will be lost. Save a version first if you want to keep them."
              : " Your saved versions stay in history, so you can come back."}
          </p>
          <div className="confirm-actions">
            <button type="button" className="button-primary" onClick={restore} disabled={busy}>
              {busy ? "Restoring…" : "Restore this design"}
            </button>
            <button type="button" className="button-quiet" onClick={() => setConfirming(null)} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && (
        <p className="inspector-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
