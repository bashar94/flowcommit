import { createContext, memo, useContext } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { NODE_KIND_INFO } from "@flowcommit/shared";
import { assetUrl, type StepNode } from "../model.ts";
import { Icon } from "../icons.tsx";
import { BUILD_LABEL, agentLabel, useStepBuild } from "../build.tsx";
import { useStepSync } from "../sync.tsx";

/** Lets a card add the next step without every card needing the whole editor passed in. */
export const StepActions = createContext<{ addAfter?: (id: string) => void }>({});

/**
 * Reading aids for each card: its step number, and whether it's faded because another part of
 * the flow is highlighted. `current` is the step a walkthrough is showing.
 */
export const StepReading = createContext<{
  numbers: Map<string, number>;
  focus: Set<string> | null;
  current: string | null;
}>({ numbers: new Map(), focus: null, current: null });

const MAX_THUMBS = 3;
const DIFF_LABEL = { added: "Added", removed: "Removed", changed: "Changed", moved: "Moved" } as const;

/**
 * One step on the canvas. Each type has the shape flowcharts usually give it, so the
 * architecture reads at a glance: pills for Start and End, a diamond for decisions, a
 * cylinder for stored data, a browser window for screens, and a box with side bars for APIs.
 */
function StepCardImpl({ id, data, selected }: NodeProps<StepNode>) {
  const { addAfter } = useContext(StepActions);
  const reading = useContext(StepReading);
  const number = reading.numbers.get(id);
  const dim = reading.focus ? !reading.focus.has(id) : false;
  const build = useStepBuild(id);
  const sync = useStepSync(id);
  const buildView = !data.diff && build && build.view !== "todo" ? build.view : undefined;
  const isTerminal = data.kind === "start" || data.kind === "end";
  const isDecision = data.kind === "decision";
  // A screen shows its first image as a preview of the page, inside its window frame.
  const cover = data.kind === "screen" ? data.attachments.find((a) => a.kind === "image") : undefined;
  const media = data.attachments.filter((a) => a.kind !== "link" && a !== cover);
  const links = data.attachments.filter((a) => a.kind === "link").length;
  const extra = media.length - MAX_THUMBS;

  const body = (
    <>
      <div className="step-head">
        <span className="step-icon">
          <Icon name={data.kind} size={14} />
        </span>
        <span className="step-kind">{NODE_KIND_INFO[data.kind].label}</span>
        {data.diff && <span className="step-diff">{DIFF_LABEL[data.diff]}</span>}
        {buildView && (
          <span className="step-build" title={build?.record?.note || BUILD_LABEL[buildView]}>
            <Icon name={buildView === "built" ? "check" : buildView === "building" ? "sparkle" : "alert"} size={11} />
            {BUILD_LABEL[buildView]}
          </span>
        )}
      </div>

      {!data.diff && (sync?.drift || !!sync?.suggestions) && (
        <div className="step-sync">
          {sync.drift && (
            <span className="sync-pill is-drift" title="This step's code was edited outside a build. Open Sync to update the flow.">
              <Icon name="alert" size={11} /> Code changed
            </span>
          )}
          {!!sync.suggestions && (
            <span className="sync-pill" title="An AI tool suggested a change here. Open Sync to review it.">
              <Icon name="sparkle" size={11} /> {sync.suggestions === 1 ? "Suggestion" : `${sync.suggestions} suggestions`}
            </span>
          )}
        </div>
      )}

      <p className={data.title ? "step-title" : "step-title is-empty"}>{data.title || "Untitled step"}</p>

      {data.tags.length > 0 && (
        <ul className="step-tags">
          {data.tags.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      )}

      {cover && (
        <div className="step-screen">
          <img src={assetUrl(cover.annotatedSrc ?? cover.src, data.assetVersion)} alt={cover.caption} draggable={false} />
          {cover.annotations.length > 0 && <span className="step-marks">{cover.annotations.length} marks</span>}
        </div>
      )}

      {!isTerminal && data.instructions && <p className="step-text">{data.instructions}</p>}

      {buildView === "blocked" && build?.record?.note && (
        <p className="step-question">
          <strong>{agentLabel(build.record.agent)} asks:</strong> {build.record.note}
        </p>
      )}

      {(media.length > 0 || links > 0) && (
        <div className="step-media">
          {media.slice(0, MAX_THUMBS).map((a) =>
            a.kind === "image" ? (
              <img key={a.id} src={assetUrl(a.annotatedSrc ?? a.src, data.assetVersion)} alt={a.caption} draggable={false} />
            ) : (
              <span key={a.id} className="step-thumb" title={a.caption || "Video"}>
                <Icon name="start" size={12} />
              </span>
            ),
          )}
          {extra > 0 && <span className="step-thumb">+{extra}</span>}
          {links > 0 && (
            <span className="step-links">
              <Icon name="link" size={12} /> {links}
            </span>
          )}
        </div>
      )}
    </>
  );

  return (
    <div
      className="step"
      data-kind={data.kind}
      data-terminal={isTerminal || undefined}
      data-selected={selected || undefined}
      data-diff={data.diff}
      data-build={buildView}
      data-dim={dim || undefined}
      data-current={reading.current === id || undefined}
    >
      {number !== undefined && !data.diff && <span className="step-number">{number}</span>}
      {data.kind !== "start" && <Handle type="target" position={Position.Top} />}

      {isDecision ? (
        <>
          <svg className="step-diamond" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <polygon points="50,1 99,50 50,99 1,50" vectorEffect="non-scaling-stroke" />
          </svg>
          <div className="step-diamond-body">{body}</div>
        </>
      ) : data.kind === "screen" ? (
        <>
          <span className="step-window-bar" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          {body}
        </>
      ) : (
        body
      )}

      {data.kind !== "end" && <Handle type="source" position={Position.Bottom} />}
      {isDecision && (
        <>
          <Handle type="source" id="left" position={Position.Left} />
          <Handle type="source" id="right" position={Position.Right} />
        </>
      )}

      {addAfter && !data.diff && data.kind !== "end" && (
        <button
          type="button"
          className="step-add nodrag"
          title="Add the next step (Tab)"
          aria-label="Add the next step"
          onClick={(e) => {
            e.stopPropagation();
            addAfter(id);
          }}
        >
          <Icon name="plus" size={14} />
        </button>
      )}
    </div>
  );
}

export const StepCard = memo(StepCardImpl);
