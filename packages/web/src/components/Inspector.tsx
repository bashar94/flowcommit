import { useId, useRef, useState, type ClipboardEvent } from "react";
import { NODE_KINDS, NODE_KIND_INFO, type Attachment, type WriteRequest } from "@flowcommit/shared";
import { api } from "../api.ts";
import { assetUrl, newId, type ArrowEdge, type FlowMeta, type StepData, type StepNode } from "../model.ts";
import { Icon } from "../icons.tsx";
import { AiField } from "./AiField.tsx";
import { Annotator } from "./Annotator.tsx";
import { useToast } from "./Toasts.tsx";
import { WordDiff } from "./ChangeDetails.tsx";
import { timeAgo } from "../time.ts";
import { BUILD_LABEL, agentLabel, type StepBuildInfo } from "../build.tsx";

export type Selection =
  | { type: "none" }
  | { type: "node"; node: StepNode; previous: string[]; next: string[]; build?: StepBuildInfo }
  | { type: "edge"; edge: ArrowEdge; from: string; to: string }
  | { type: "many"; count: number };

type Props = {
  selection: Selection;
  meta: FlowMeta;
  stepCount: number;
  /** Every tag used anywhere in the flow, offered as suggestions. */
  allTags: string[];
  /** Changes whenever a new step should get its title focused, so the user can type straight away. */
  focusTitleKey: number;
  onMetaChange: (patch: Partial<FlowMeta>) => void;
  onNodeChange: (id: string, patch: Partial<StepData>) => void;
  onEdgeLabelChange: (id: string, label: string) => void;
  onDeleteNode: (id: string) => void;
  onDeleteEdge: (id: string) => void;
  onAddAfter: (id: string) => void;
  onResetBuild: (id: string) => void;
};

export function Inspector(props: Props) {
  const { selection, meta } = props;
  const flowContext = { flowName: meta.name, flowDescription: meta.description };
  return (
    <aside className="inspector panel" aria-label="Details">
      {selection.type === "node" && (
        <NodeDetails
          key={selection.node.id}
          node={selection.node}
          focusTitleKey={props.focusTitleKey}
          context={{ ...flowContext, previous: selection.previous, next: selection.next }}
          onChange={(patch) => props.onNodeChange(selection.node.id, patch)}
          onDelete={() => props.onDeleteNode(selection.node.id)}
          onAddAfter={() => props.onAddAfter(selection.node.id)}
          build={selection.build}
          onResetBuild={() => props.onResetBuild(selection.node.id)}
          allTags={props.allTags}
        />
      )}
      {selection.type === "edge" && (
        <EdgeDetails
          key={selection.edge.id}
          edge={selection.edge}
          from={selection.from}
          to={selection.to}
          onLabelChange={(label) => props.onEdgeLabelChange(selection.edge.id, label)}
          onDelete={() => props.onDeleteEdge(selection.edge.id)}
        />
      )}
      {selection.type === "many" && (
        <div className="inspector-section">
          <h2 className="inspector-title">{selection.count} items selected</h2>
          <p className="inspector-note">Drag to move them together, or press Delete to remove them.</p>
        </div>
      )}
      {selection.type === "none" && (
        <FlowDetails meta={meta} stepCount={props.stepCount} onChange={props.onMetaChange} />
      )}
    </aside>
  );
}

function FlowDetails({
  meta,
  stepCount,
  onChange,
}: {
  meta: FlowMeta;
  stepCount: number;
  onChange: (patch: Partial<FlowMeta>) => void;
}) {
  const context = { flowName: meta.name, flowDescription: meta.description };
  return (
    <>
      <div className="inspector-section">
        <p className="inspector-eyebrow">
          {stepCount} {stepCount === 1 ? "step" : "steps"}
        </p>
        <label className="field">
          <span>App name</span>
          <input className="input-title" value={meta.name} onChange={(e) => onChange({ name: e.target.value })} />
        </label>
        <AiField
          field="description"
          label="What are you building?"
          multiline
          rows={5}
          value={meta.description}
          context={context}
          placeholder="A habit tracker where people log a daily check-in and see their streak."
          hint="The AI builder reads this before every step."
          onChange={(description) => onChange({ description })}
        />
      </div>
      <div className="inspector-section">
        <h2 className="inspector-title">Shortcuts</h2>
        <dl className="shortcuts">
          <dt>Tab</dt>
          <dd>Add the next step after the selected one</dd>
          <dt>⌘J</dt>
          <dd>Ask AI while typing in a text box</dd>
          <dt>⌘S</dt>
          <dd>Save a version</dd>
          <dt>Delete</dt>
          <dd>Remove what's selected</dd>
        </dl>
      </div>
    </>
  );
}

function NodeDetails({
  node,
  focusTitleKey,
  context,
  onChange,
  onDelete,
  onAddAfter,
  build,
  onResetBuild,
  allTags,
}: {
  allTags: string[];
  build?: StepBuildInfo;
  onResetBuild: () => void;
  node: StepNode;
  focusTitleKey: number;
  context: Omit<WriteRequest["context"], "step">;
  onChange: (patch: Partial<StepData>) => void;
  onDelete: () => void;
  onAddAfter: () => void;
}) {
  const { data } = node;
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [link, setLink] = useState("");
  const [markingUp, setMarkingUp] = useState<string | null>(null);
  const notify = useToast();
  // Uploads finish one by one, so read the latest attachments instead of the ones from this render.
  const attachmentsRef = useRef(data.attachments);
  attachmentsRef.current = data.attachments;

  const stepContext: WriteRequest["context"] = {
    ...context,
    step: { kind: data.kind, title: data.title, instructions: data.instructions },
  };

  const setAttachments = (next: Attachment[]) => {
    attachmentsRef.current = next;
    onChange({ attachments: next });
  };

  const upload = async (files: File[]) => {
    const accepted = files.filter((f) => /^(image|video)\//.test(f.type));
    setError(accepted.length < files.length ? "Only images and videos can be attached." : "");
    for (const file of accepted) {
      setUploading((n) => n + 1);
      try {
        const { src, kind } = await api.uploadAsset(file);
        const attachment: Attachment = { id: newId("a"), kind, src, caption: "", annotations: [] };
        setAttachments([...attachmentsRef.current, attachment]);
        if (kind === "image") {
          notify("Image attached. Mark it up to point at exactly what you mean.", {
            action: { label: "Mark up", run: () => setMarkingUp(attachment.id) },
          });
        }
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };

  const onPaste = (e: ClipboardEvent) => {
    const files = Array.from(e.clipboardData.files);
    if (files.length === 0) return;
    e.preventDefault();
    void upload(files);
  };

  const addLink = () => {
    let url: URL;
    try {
      url = new URL(link.trim());
    } catch {
      setError("Enter a full link, starting with https://");
      return;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      setError("Links must start with https:// or http://");
      return;
    }
    setError("");
    setAttachments([...attachmentsRef.current, { id: newId("a"), kind: "link", src: url.href, caption: "", annotations: [] }]);
    setLink("");
  };

  const updateAttachment = (id: string, patch: Partial<Attachment>) =>
    setAttachments(attachmentsRef.current.map((a) => (a.id === id ? { ...a, ...patch } : a)));

  return (
    <>
      <div className="inspector-section">
        <div className="kind-picker" role="radiogroup" aria-label="Step type">
          {NODE_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={data.kind === k}
              data-kind={k}
              title={NODE_KIND_INFO[k].hint}
              onClick={() => onChange({ kind: k })}
            >
              <Icon name={k} size={14} />
              <span>{NODE_KIND_INFO[k].label}</span>
            </button>
          ))}
        </div>

        <AiField
          field="title"
          label="Title"
          value={data.title}
          context={stepContext}
          autoFocusKey={focusTitleKey}
          placeholder="Show the sign-up form"
          onChange={(title) => onChange({ title })}
        />
        <TagInput tags={data.tags} suggestions={allTags} onChange={(tags) => onChange({ tags })} />
        <AiField
          field="instructions"
          label="Instructions for the AI builder"
          multiline
          rows={7}
          value={data.instructions}
          context={stepContext}
          placeholder="Describe what this step does and what the user sees. Not sure? Click AI and pick Write it for me."
          hint="Paste a screenshot here to attach it."
          onChange={(instructions) => onChange({ instructions })}
          onPaste={onPaste}
        />
      </div>

      {markingUp &&
        (() => {
          const target = data.attachments.find((a) => a.id === markingUp);
          if (!target) return null;
          return (
            <Annotator
              imageUrl={assetUrl(target.src)}
              imageName={target.src}
              initial={target.annotations}
              onClose={() => setMarkingUp(null)}
              onSave={(annotations, annotatedSrc) => {
                updateAttachment(target.id, { annotations, annotatedSrc });
                setMarkingUp(null);
                notify(
                  annotations.length
                    ? `Saved ${annotations.length} ${annotations.length === 1 ? "mark" : "marks"}. The AI builder will see them.`
                    : "Marks removed.",
                );
              }}
            />
          );
        })()}

      <div className="inspector-section">
        <h2 className="inspector-title">Attachments</h2>
        <ul className="attachments">
          {data.attachments.map((a) => (
            <li key={a.id} className="attachment">
              <div className="attachment-preview">
                {a.kind === "image" && (
                  <button type="button" className="markup-preview" onClick={() => setMarkingUp(a.id)} title="Mark up this image">
                    <img src={assetUrl(a.annotatedSrc ?? a.src)} alt={a.caption} />
                    <span className="markup-chip">
                      <Icon name="markup" size={14} />
                      {a.annotations.length
                        ? `${a.annotations.length} ${a.annotations.length === 1 ? "mark" : "marks"}, edit`
                        : "Mark up"}
                    </span>
                  </button>
                )}
                {a.kind === "video" && <video src={assetUrl(a.src)} controls preload="metadata" />}
                {a.kind === "link" && (
                  <a href={a.src} target="_blank" rel="noreferrer">
                    <Icon name="link" size={14} /> {a.src}
                  </a>
                )}
                <button
                  type="button"
                  className="attachment-remove"
                  aria-label="Remove attachment"
                  title="Remove"
                  onClick={() => setAttachments(attachmentsRef.current.filter((x) => x.id !== a.id))}
                >
                  <Icon name="close" size={12} />
                </button>
              </div>
              <AiField
                field="caption"
                label="Caption"
                value={a.caption}
                context={stepContext}
                placeholder="What should the AI notice here?"
                onChange={(caption) => updateAttachment(a.id, { caption })}
              />
            </li>
          ))}
        </ul>

        <input
          ref={fileInput}
          type="file"
          accept="image/*,video/*"
          multiple
          hidden
          onChange={(e) => {
            void upload(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
        <button
          type="button"
          className="dropzone"
          data-dragging={dragging || undefined}
          disabled={uploading > 0}
          onClick={() => fileInput.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void upload(Array.from(e.dataTransfer.files));
          }}
        >
          <Icon name="image" size={18} />
          <span>{uploading > 0 ? "Uploading…" : "Drop a mockup, screenshot or video, or click to choose"}</span>
        </button>

        <div className="link-row">
          <input
            aria-label="Link"
            value={link}
            placeholder="Paste a reference link"
            onChange={(e) => setLink(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addLink()}
          />
          <button type="button" className="button" onClick={addLink} disabled={!link.trim()}>
            Add link
          </button>
        </div>
        {error && (
          <p className="inspector-error" role="alert">
            {error}
          </p>
        )}
      </div>

      {build && build.view !== "todo" && (
        <BuildSection build={build} instructions={data.instructions} onReset={onResetBuild} />
      )}

      <div className="inspector-section inspector-footer">
        {data.kind !== "end" && (
          <button type="button" className="button" onClick={onAddAfter}>
            <Icon name="plus" size={14} /> Add next step
          </button>
        )}
        <button type="button" className="button-danger" onClick={onDelete}>
          Delete step
        </button>
      </div>
    </>
  );
}

function EdgeDetails({
  edge,
  from,
  to,
  onLabelChange,
  onDelete,
}: {
  edge: ArrowEdge;
  from: string;
  to: string;
  onLabelChange: (label: string) => void;
  onDelete: () => void;
}) {
  return (
    <div className="inspector-section">
      <p className="inspector-eyebrow">Arrow</p>
      <h2 className="inspector-title">
        {from} to {to}
      </h2>
      <label className="field">
        <span>Label</span>
        <input
          autoFocus
          value={edge.data?.label ?? ""}
          placeholder="Yes, No, On error…"
          onChange={(e) => onLabelChange(e.target.value)}
        />
        <small className="field-hint">Labels matter most on arrows that leave a decision.</small>
      </label>
      <div className="label-chips">
        {["Yes", "No", "On error", "Try again"].map((l) => (
          <button key={l} type="button" className="chip" onClick={() => onLabelChange(l)}>
            {l}
          </button>
        ))}
      </div>
      <button type="button" className="button-danger" onClick={onDelete}>
        Delete arrow
      </button>
    </div>
  );
}

function BuildSection({
  build,
  instructions,
  onReset,
}: {
  build: StepBuildInfo;
  instructions: string;
  onReset: () => void;
}) {
  const { view, record } = build;
  const who = agentLabel(record?.agent);
  const when = record ? timeAgo(record.updatedAt) : "";
  const before = record?.builtSpec?.instructions;
  return (
    <div className="inspector-section build-panel" data-build={view}>
      <div className="build-panel-head">
        <h2 className="inspector-title">Build</h2>
        <span className="build-chip">{BUILD_LABEL[view]}</span>
      </div>

      {view === "building" && <p className="inspector-note">{who} is building this step right now.</p>}

      {view === "blocked" && (
        <>
          <p className="build-question">
            <strong>{who} asks:</strong> {record?.note}
          </p>
          <p className="inspector-note">Answer by updating the instructions, then mark it ready to build again.</p>
          <button type="button" className="button" onClick={onReset}>
            Mark ready to build
          </button>
        </>
      )}

      {(view === "built" || view === "outdated") && (
        <>
          <p className="inspector-note">
            {view === "built" ? `Built by ${who} ${when}.` : `You changed this step after ${who} built it ${when}. The next build will update it.`}
          </p>
          {view === "outdated" && before !== undefined && before !== instructions && (
            <div className="field">
              <span>What changed in the instructions</span>
              <WordDiff before={before} after={instructions} />
            </div>
          )}
          {record?.note && <p className="build-summary">{record.note}</p>}
          {record && record.files.length > 0 && (
            <ul className="build-files">
              {record.files.map((f) => (
                <li key={f}>
                  <code>{f}</code>
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="button-quiet build-reset" onClick={onReset}>
            Mark as not built
          </button>
        </>
      )}
    </div>
  );
}

/** Tags as removable chips. Type a tag and press Enter (or a comma) to add it. */
function TagInput({
  tags,
  suggestions,
  onChange,
}: {
  tags: string[];
  suggestions: string[];
  onChange: (tags: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const id = useId();
  const add = (raw: string) => {
    const tag = raw.trim().replace(/,$/, "").trim().slice(0, 30);
    if (tag && !tags.some((t) => t.toLowerCase() === tag.toLowerCase())) onChange([...tags, tag]);
    setDraft("");
  };
  const unused = suggestions.filter((s) => !tags.includes(s));
  return (
    <div className="field">
      <label htmlFor={id}>
        <span className="field-label">Tags</span>
      </label>
      <div className="tag-input">
        {tags.map((t) => (
          <span key={t} className="tag-chip">
            {t}
            <button type="button" aria-label={`Remove tag ${t}`} onClick={() => onChange(tags.filter((x) => x !== t))}>
              <Icon name="close" size={10} />
            </button>
          </span>
        ))}
        <input
          id={id}
          value={draft}
          list={`${id}-list`}
          placeholder={tags.length ? "" : "auth, payment, MVP…"}
          onChange={(e) => (e.target.value.endsWith(",") ? add(e.target.value) : setDraft(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add(draft);
            } else if (e.key === "Backspace" && !draft && tags.length) {
              onChange(tags.slice(0, -1));
            }
          }}
          onBlur={() => draft && add(draft)}
        />
        <datalist id={`${id}-list`}>
          {unused.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      </div>
    </div>
  );
}
