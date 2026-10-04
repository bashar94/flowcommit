import { useEffect, useRef, useState } from "react";
import { api, type FolderListing, type ProjectRef, type RecentProject } from "../api.ts";
import { Icon } from "../icons.tsx";
import { timeAgo } from "../time.ts";

type Props = {
  /** The app's name from the flow, shown on the button. */
  flowName: string;
  /** Saves pending edits before another project replaces this one. */
  beforeSwitch: () => Promise<void>;
};

/**
 * Which project is open, and the way to another one: recent projects, any folder on this
 * computer, or a brand new project. Switching reloads the page with the other project.
 */
export function ProjectMenu({ flowName, beforeSwitch }: Props) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ current: ProjectRef; recent: RecentProject[] } | null>(null);
  const [picker, setPicker] = useState<"open" | "create" | null>(null);
  const [error, setError] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.projects().then(setData).catch(() => setData(null));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setError("");
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const switchTo = async (task: () => Promise<unknown>) => {
    setError("");
    try {
      await beforeSwitch();
      await task();
      window.location.reload();
    } catch (err) {
      setError((err as Error).message);
      throw err;
    }
  };

  return (
    <div className="branch-menu project-menu" ref={ref}>
      <button
        type="button"
        className="topbar-project"
        aria-expanded={open}
        title={data ? `${flowName}, in ${data.current.path}` : flowName}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="branch-button-name">{flowName || data?.current.name}</span>
        <Icon name="chevron" size={13} />
      </button>

      {open && (
        <div className="popover branch-popover project-popover">
          {data && (
            <div>
              <p className="popover-title">
                <Icon name="folder" size={14} /> {data.current.name}
              </p>
              <p className="inspector-note project-path">{data.current.path}</p>
            </div>
          )}
          <div className="sync-actions">
            <button type="button" className="button" onClick={() => { setPicker("open"); setOpen(false); }}>
              <Icon name="folder" size={14} /> Open a folder
            </button>
            <button type="button" className="button" onClick={() => { setPicker("create"); setOpen(false); }}>
              <Icon name="plus" size={14} /> New project
            </button>
          </div>

          {data && data.recent.length > 0 && (
            <section className="branch-section">
              <h3 className="dialog-subtitle">Recent projects</h3>
              <ul className="branch-options project-options">
                {data.recent.map((p) => (
                  <li key={p.path}>
                    <button
                      type="button"
                      className="branch-option"
                      disabled={p.missing}
                      title={p.missing ? `${p.path} was moved or deleted` : p.path}
                      onClick={() => void switchTo(() => api.openProject(p.path)).catch(() => {})}
                    >
                      <Icon name="folder" size={13} />
                      <span className="project-option-text">
                        <span>{p.name}</span>
                        <span className="project-option-path">{p.missing ? "Folder not found" : p.path}</span>
                      </span>
                      <span className="branch-current">{timeAgo(p.openedAt)}</span>
                    </button>
                    <button
                      type="button"
                      className="icon-button project-forget"
                      aria-label={`Remove ${p.name} from recent projects`}
                      title="Remove from this list (the folder stays)"
                      onClick={async () => {
                        const { recent } = await api.forgetProject(p.path);
                        setData((d) => d && { ...d, recent });
                      }}
                    >
                      <Icon name="close" size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {error && (
            <p className="inspector-error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}

      {picker && (
        <FolderPicker
          mode={picker}
          start={data?.current.path}
          onOpen={(path) => switchTo(() => api.openProject(path))}
          onCreate={(parent, name) => switchTo(() => api.createProject(parent, name))}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}

type PickerProps = {
  mode: "open" | "create";
  start?: string;
  onOpen: (path: string) => Promise<void>;
  onCreate: (parent: string, name: string) => Promise<void>;
  onClose: () => void;
};

/** Browses this computer's folders. Folders that already have a FlowCommit flow are listed first. */
function FolderPicker({ mode, start, onOpen, onCreate, onClose }: PickerProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const [listing, setListing] = useState<FolderListing | null>(null);
  const [typed, setTyped] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const go = async (path?: string) => {
    setError("");
    try {
      const next = await api.folders(path);
      setListing(next);
      setTyped(next.path);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  useEffect(() => {
    ref.current?.showModal();
    // Start one level up from the open project, where its sibling projects usually are.
    void go(start ? start.replace(/[\\/][^\\/]+[\\/]?$/, "") || undefined : undefined);
  }, [start]);

  const submit = async () => {
    if (!listing) return;
    setBusy(true);
    setError("");
    try {
      if (mode === "open") await onOpen(listing.path);
      else await onCreate(listing.path, name);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  // Deep folders show only the last few names; the path box above has the whole path.
  const crumbs = listing ? breadcrumbs(listing.path).slice(-4) : [];

  return (
    <dialog ref={ref} className="dialog folder-dialog" aria-labelledby="folder-title" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <header className="build-header">
          <div>
            <h2 id="folder-title" className="dialog-title">
              {mode === "open" ? "Open a project" : "New project"}
            </h2>
            <p className="inspector-note">
              {mode === "open"
                ? "Pick your app's folder. If it doesn't have a flow yet, FlowCommit adds a .flowcommit folder for it."
                : "Pick where the new project goes. FlowCommit makes a folder for it and turns on Git, so every version is kept."}
            </p>
          </div>
          <button type="button" className="icon-button" aria-label="Close" onClick={() => ref.current?.close()}>
            <Icon name="close" />
          </button>
        </header>

        <div className="new-branch">
          <input
            value={typed}
            aria-label="Folder path"
            placeholder="/Users/you/projects/my-app"
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void go(typed);
              }
            }}
          />
          <button type="button" className="button" onClick={() => void go(typed)}>
            Go
          </button>
        </div>

        {listing && (
          <>
            <nav className="folder-crumbs" aria-label="Folder path">
              <button type="button" className="button-quiet" onClick={() => void go(listing.home)}>
                Home
              </button>
              {crumbs.map((c, i) => (
                <span key={c.path}>
                  <span aria-hidden="true">/</span>
                  <button type="button" className="button-quiet" disabled={i === crumbs.length - 1} onClick={() => void go(c.path)}>
                    {c.name}
                  </button>
                </span>
              ))}
            </nav>
            <ul className="folder-list" aria-label="Folders">
              {listing.parent && (
                <li>
                  <button type="button" className="branch-option" onClick={() => void go(listing.parent!)}>
                    <Icon name="undo" size={13} />
                    <span>Up one folder</span>
                  </button>
                </li>
              )}
              {listing.folders.map((f) => (
                <li key={f.path}>
                  <button type="button" className="branch-option" onClick={() => void go(f.path)}>
                    <Icon name="folder" size={13} />
                    <span className="folder-name">{f.name}</span>
                    {f.flowcommit && <span className="folder-badge is-flow">Has a flow</span>}
                    {!f.flowcommit && f.git && <span className="folder-badge">Git</span>}
                  </button>
                </li>
              ))}
              {listing.folders.length === 0 && <li className="inspector-note folder-empty">No folders in here.</li>}
            </ul>
          </>
        )}

        {mode === "create" && (
          <label className="field">
            <span>Project name</span>
            <input value={name} placeholder="my-app" onChange={(e) => setName(e.target.value)} />
          </label>
        )}

        {error && (
          <p className="inspector-error" role="alert">
            {error}
          </p>
        )}

        <div className="confirm-actions folder-actions">
          <span className="inspector-note folder-target">
            {listing &&
              (mode === "open"
                ? listing.flowcommit
                  ? "This folder has a flow."
                  : `Opens ${lastPart(listing.path)}`
                : name.trim()
                  ? `Makes ${listing.path.replace(/\/$/, "")}/${name.trim()}`
                  : "Name your project")}
          </span>
          <button type="button" className="button-quiet" onClick={() => ref.current?.close()}>
            Cancel
          </button>
          <button type="submit" className="button-primary" disabled={!listing || busy || (mode === "create" && !name.trim())}>
            {busy ? "Opening…" : mode === "open" ? "Open this folder" : "Create project"}
          </button>
        </div>
      </form>
    </dialog>
  );
}

function lastPart(p: string) {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? p;
}

function breadcrumbs(p: string) {
  const parts = p.split("/").filter(Boolean);
  return parts.map((name, i) => ({ name, path: "/" + parts.slice(0, i + 1).join("/") }));
}
