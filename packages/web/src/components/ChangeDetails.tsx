import {
  NODE_KIND_INFO,
  diffWords,
  sortByPosition,
  type Attachment,
  type EdgeDiff,
  type FlowDiff,
  type NodeDiff,
} from "@flowcommit/shared";
import { assetUrl } from "../model.ts";
import type { Side } from "../compare.ts";

const STATUS_LABEL = { added: "Added", removed: "Removed", changed: "Changed", unchanged: "No changes" } as const;

/** Everything that changed between the two sides, as a list you can click to find each step. */
export function ChangeList({ diff, onFocus }: { diff: FlowDiff; onFocus: (id: string) => void }) {
  const titleOf = new Map(
    diff.nodes.map((n) => [n.id, (n.status === "removed" ? n.before.title : n.after.title) || "Untitled step"]),
  );
  const steps = sortByPosition(diff.nodes.filter((n) => n.status !== "unchanged"));
  const moved = diff.nodes.filter((n) => n.status === "unchanged" && n.moved);
  const arrows = diff.edges.filter((e) => e.status !== "unchanged");
  const { name, description } = diff.meta;

  if (!steps.length && !arrows.length && !name && !description && !moved.length) {
    return <p className="inspector-note">These two versions are the same.</p>;
  }

  return (
    <div className="change-list">
      {steps.length > 0 && (
        <section>
          <h3>Steps</h3>
          <ul>
            {steps.map((n) => (
              <li key={n.id}>
                <button type="button" className="change-row" data-status={n.status} onClick={() => onFocus(n.id)}>
                  <span className="change-status">{STATUS_LABEL[n.status]}</span>
                  <span className="change-name">{titleOf.get(n.id)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {arrows.length > 0 && (
        <section>
          <h3>Arrows</h3>
          <ul>
            {arrows.map((e) => (
              <li key={e.key} className="change-row is-static" data-status={e.status}>
                <span className="change-status">{STATUS_LABEL[e.status]}</span>
                <span className="change-name">{arrowText(e, titleOf)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {moved.length > 0 && (
        <p className="inspector-note">
          {moved.length === 1 ? "1 step was" : `${moved.length} steps were`} moved on the canvas.
        </p>
      )}
      {(name || description) && (
        <section>
          <h3>About this flow</h3>
          {name && <TextChange label="Flow name" before={name.before} after={name.after} />}
          {description && <TextChange label="What are you building?" before={description.before} after={description.after} />}
        </section>
      )}
    </div>
  );
}

function arrowText(e: EdgeDiff, titleOf: Map<string, string>) {
  const edge = e.status === "removed" ? e.before : e.after;
  const route = `${titleOf.get(edge.source)} to ${titleOf.get(edge.target)}`;
  if (e.status === "changed") return `${route}: label "${e.before.label}" is now "${e.after.label}"`;
  return edge.label ? `${route} (${edge.label})` : route;
}

/** What happened to one step between the two sides. */
export function NodeChanges({ change, base, target }: { change: NodeDiff; base: Side; target: Side }) {
  const before = change.status === "added" ? null : change.before;
  const after = change.status === "removed" ? null : change.after;
  const current = (after ?? before)!;
  const beforeAssets = base.kind === "version" ? base.sha : undefined;
  const afterAssets = target.kind === "version" ? target.sha : undefined;

  return (
    <div className="inspector-section">
      <span className="change-badge" data-status={change.status}>
        {STATUS_LABEL[change.status]}
      </span>

      {before && after && before.title !== after.title ? (
        <TextChange label="Title" before={before.title} after={after.title} />
      ) : (
        <h2 className="inspector-title">{current.title || "Untitled step"}</h2>
      )}

      {before && after && before.kind !== after.kind && (
        <p className="inspector-note">
          Type changed from {NODE_KIND_INFO[before.kind].label} to {NODE_KIND_INFO[after.kind].label}.
        </p>
      )}

      <div className="field">
        <span>Instructions for the AI</span>
        <WordDiff before={before?.instructions ?? ""} after={after?.instructions ?? ""} />
      </div>

      <AttachmentChanges
        before={before?.attachments ?? []}
        after={after?.attachments ?? []}
        beforeAssets={beforeAssets}
        afterAssets={afterAssets}
      />

      {(change.status === "changed" || change.status === "unchanged") && change.moved && (
        <p className="inspector-note">Moved on the canvas.</p>
      )}
    </div>
  );
}

function TextChange({ label, before, after }: { label: string; before: string; after: string }) {
  return (
    <div className="field">
      <span>{label}</span>
      <WordDiff before={before} after={after} />
    </div>
  );
}

export function WordDiff({ before, after }: { before: string; after: string }) {
  const parts = diffWords(before, after);
  if (parts.length === 0) return <p className="inspector-note">None</p>;
  return (
    <p className="word-diff">
      {parts.map((p, i) =>
        p.type === "added" ? <ins key={i}>{p.text}</ins> : p.type === "removed" ? <del key={i}>{p.text}</del> : <span key={i}>{p.text}</span>,
      )}
    </p>
  );
}

function AttachmentChanges({
  before,
  after,
  beforeAssets,
  afterAssets,
}: {
  before: Attachment[];
  after: Attachment[];
  beforeAssets?: string;
  afterAssets?: string;
}) {
  const old = new Map(before.map((a) => [a.id, a]));
  const rows: {
    a: Attachment;
    status: "added" | "removed" | "changed" | "unchanged";
    version?: string;
    oldCaption?: string;
    marksChanged?: boolean;
  }[] = [];
  const sameMarks = (x: Attachment, y: Attachment) => JSON.stringify(x.annotations) === JSON.stringify(y.annotations);
  for (const a of after) {
    const b = old.get(a.id);
    if (!b) rows.push({ a, status: "added", version: afterAssets });
    else if (b.caption !== a.caption || !sameMarks(a, b))
      rows.push({ a, status: "changed", version: afterAssets, oldCaption: b.caption, marksChanged: !sameMarks(a, b) });
    else rows.push({ a, status: "unchanged", version: afterAssets });
  }
  const keep = new Set(after.map((a) => a.id));
  for (const b of before) if (!keep.has(b.id)) rows.push({ a: b, status: "removed", version: beforeAssets });
  if (rows.length === 0) return null;

  return (
    <div className="field">
      <span>Attachments</span>
      <ul className="attachments">
        {rows.map(({ a, status, version, oldCaption, marksChanged }) => (
          <li key={a.id} className="attachment" data-status={status}>
            {status !== "unchanged" && <span className="change-status">{STATUS_LABEL[status]}</span>}
            <div className="attachment-preview">
              {a.kind === "image" && <img src={assetUrl(a.annotatedSrc ?? a.src, version)} alt={a.caption} />}
              {a.kind === "video" && <video src={assetUrl(a.src, version)} controls preload="metadata" />}
              {a.kind === "link" && (
                <a href={a.src} target="_blank" rel="noreferrer">
                  {a.src}
                </a>
              )}
            </div>
            {status === "changed" && oldCaption !== a.caption ? (
              <WordDiff before={oldCaption ?? ""} after={a.caption} />
            ) : (
              a.caption && <p className="inspector-note">{a.caption}</p>
            )}
            {marksChanged && <p className="inspector-note">The marks on this image changed.</p>}
            {a.annotations.length > 0 && (
              <ol className="mark-notes">
                {a.annotations.map((m) => (
                  <li key={m.id}>{m.note || "No note"}</li>
                ))}
              </ol>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
