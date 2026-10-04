import { useEffect, useRef, useState } from "react";
import { api, type Graph, type PullRequest } from "../api.ts";
import { Icon } from "../icons.tsx";
import { timeAgo } from "../time.ts";

type Props = {
  graph: Graph | null;
  hasUnsavedDesign: boolean;
  onSwitch: (branch: string) => Promise<void>;
  onCreate: (name: string) => Promise<void>;
  onSync: (what: "push" | "pull" | "fetch") => Promise<void>;
  onReviewBranch: (branch: string) => void;
  onReviewPullRequest: (pr: PullRequest) => void;
};

/**
 * The current branch, and everything that connects the design to GitHub: switching and
 * creating branches, pushing and pulling, opening a pull request and reviewing others'.
 * It runs the same git commands you would, with your own Git and GitHub sign-in.
 */
export function BranchMenu({ graph, hasUnsavedDesign, onSwitch, onCreate, onSync, onReviewBranch, onReviewPullRequest }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [newName, setNewName] = useState("");
  const [prs, setPrs] = useState<{ available: boolean; reason?: string; prs: PullRequest[] } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setError("");
    if (graph?.remote) api.pullRequests().then(setPrs).catch(() => setPrs(null));
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, graph?.remote]);

  if (!graph || (!graph.current.branch && graph.commits.length === 0)) return null;

  const run = async (label: string, task: () => Promise<unknown>) => {
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

  const { branch } = graph.current;
  const { ahead, behind, upstream } = graph.sync;
  const local = graph.branches.filter((b) => !b.remote);
  const localNames = new Set(local.map((b) => b.name));
  const remoteOnly = graph.branches.filter((b) => b.remote && !localNames.has(b.name.replace(/^[^/]+\//, "")));
  const compareUrl =
    graph.remote?.webUrl && branch && branch !== graph.defaultBranch
      ? `${graph.remote.webUrl}/compare/${encodeURIComponent(graph.defaultBranch)}...${encodeURIComponent(branch)}?expand=1`
      : null;

  const syncText = !graph.remote
    ? "Not connected to GitHub"
    : !upstream
      ? "Not on GitHub yet"
      : ahead === 0 && behind === 0
        ? `Up to date with ${upstream}`
        : [ahead && `${ahead} to push`, behind && `${behind} to pull`].filter(Boolean).join(", ");

  return (
    <div className="branch-menu" ref={ref}>
      <button type="button" className="branch-button" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name="branch" size={14} />
        <span className="branch-button-name">{branch ?? "Detached"}</span>
        {ahead > 0 && <span className="sync-badge" title={`${ahead} commits to push`}>↑{ahead}</span>}
        {behind > 0 && <span className="sync-badge is-behind" title={`${behind} commits to pull`}>↓{behind}</span>}
        <Icon name="chevron" size={14} />
      </button>

      {open && (
        <div className="popover branch-popover">
          <div className="branch-sync">
            <div>
              <p className="popover-title">
                <Icon name="branch" size={14} /> {branch ?? "No branch"}
              </p>
              <p className="inspector-note">{syncText}</p>
            </div>
            {graph.remote?.webUrl && (
              <a className="icon-button" href={graph.remote.webUrl} target="_blank" rel="noreferrer" title="Open on GitHub">
                <Icon name="github" size={16} />
              </a>
            )}
          </div>

          {graph.remote && (
            <div className="sync-actions">
              <button type="button" className="button" disabled={!!busy} onClick={() => run("fetch", () => onSync("fetch"))}>
                <Icon name="cloud" size={14} /> {busy === "fetch" ? "Checking…" : "Check GitHub"}
              </button>
              <button type="button" className="button" disabled={!!busy || behind === 0} onClick={() => run("pull", () => onSync("pull"))}>
                <Icon name="download" size={14} /> {busy === "pull" ? "Pulling…" : "Pull"}
              </button>
              <button
                type="button"
                className="button-primary"
                disabled={!!busy || (!!upstream && ahead === 0)}
                title={hasUnsavedDesign ? "Save a version first so your latest design is included" : undefined}
                onClick={() => run("push", () => onSync("push"))}
              >
                <Icon name="upload" size={14} /> {busy === "push" ? "Pushing…" : "Push"}
              </button>
            </div>
          )}
          {hasUnsavedDesign && graph.remote && (
            <p className="inspector-note">You have design changes that aren't saved as a version yet. Pushing sends only saved versions.</p>
          )}

          {compareUrl && (
            <div className="branch-actions">
              <button type="button" className="button" onClick={() => { onReviewBranch(branch!); setOpen(false); }}>
                Review changes against {graph.defaultBranch}
              </button>
              <a className="button" href={compareUrl} target="_blank" rel="noreferrer">
                <Icon name="github" size={14} /> Open pull request
              </a>
            </div>
          )}

          <section className="branch-section">
            <h3 className="dialog-subtitle">Switch branch</h3>
            <p className="inspector-note">Switching also switches your code, like <code>git switch</code>.</p>
            <ul className="branch-options">
              {[...local, ...remoteOnly].map((b) => (
                <li key={b.name}>
                  <button
                    type="button"
                    className="branch-option"
                    aria-current={b.current || undefined}
                    disabled={b.current || !!busy}
                    onClick={() => run("switch", async () => { await onSwitch(b.name); setOpen(false); })}
                  >
                    <Icon name={b.remote ? "cloud" : "branch"} size={13} />
                    <span>{b.name}</span>
                    {b.current && <span className="branch-current">Current</span>}
                  </button>
                </li>
              ))}
            </ul>
            <form
              className="new-branch"
              onSubmit={(e) => {
                e.preventDefault();
                if (!newName.trim()) return;
                void run("create", async () => {
                  await onCreate(newName.trim());
                  setNewName("");
                  setOpen(false);
                });
              }}
            >
              <input
                value={newName}
                placeholder="New branch, like design/new-checkout"
                aria-label="New branch name"
                onChange={(e) => setNewName(e.target.value)}
              />
              <button type="submit" className="button" disabled={!newName.trim() || !!busy}>
                Create
              </button>
            </form>
          </section>

          {graph.remote && (
            <section className="branch-section">
              <h3 className="dialog-subtitle">Pull requests</h3>
              {!prs ? (
                <p className="inspector-note">Loading…</p>
              ) : !prs.available ? (
                <p className="inspector-note">{prs.reason}</p>
              ) : prs.prs.length === 0 ? (
                <p className="inspector-note">No open pull requests.</p>
              ) : (
                <ul className="pr-list">
                  {prs.prs.map((pr) => (
                    <li key={pr.number}>
                      <div>
                        <a href={pr.url} target="_blank" rel="noreferrer" className="pr-title">
                          #{pr.number} {pr.title}
                        </a>
                        <span className="inspector-note">
                          {pr.author}, {timeAgo(pr.updatedAt)}, {pr.headRefName} into {pr.baseRefName}
                          {pr.isDraft ? ", draft" : ""}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="button"
                        disabled={!!busy}
                        onClick={() => {
                          onReviewPullRequest(pr);
                          setOpen(false);
                        }}
                      >
                        Review
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {error && (
            <p className="inspector-error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
