import { createContext, memo, useContext, useEffect, useRef, useState } from "react";
import { Handle, Position, ViewportPortal, useStore, type NodeProps } from "@xyflow/react";
import type { FlowGroup } from "@flowcommit/shared";
import type { StepNode } from "../model.ts";
import { FRAME, groupBounds, type GroupCardNode } from "../groups.ts";
import { Icon } from "../icons.tsx";

/** What the canvas can do with a group, for the frames and the folded cards. */
export type GroupActions = {
  fold: (groupId: string) => void;
  unfold: (groupId: string) => void;
  rename: (groupId: string, title: string) => void;
  ungroup: (groupId: string) => void;
  /** Moves every step in the group by this much, in flow coordinates. */
  move: (groupId: string, dx: number, dy: number) => void;
  /** Called once a drag of the frame ends. */
  moved: () => void;
};
export const GroupActionsContext = createContext<GroupActions | null>(null);

const PAD = FRAME.pad;
const HEADER = FRAME.header;

/** A frame around each open group's steps. Its title bar moves, renames, folds or ungroups it. */
export function GroupFrames({
  groups,
  nodes,
  folded,
  editing,
  onEditDone,
}: {
  groups: FlowGroup[];
  nodes: StepNode[];
  folded: Set<string>;
  /** A group whose title should be edited right away, like one just made. */
  editing: string | null;
  onEditDone: () => void;
}) {
  return (
    <ViewportPortal>
      {groups.map((g) => {
        if (folded.has(g.id)) return null;
        const box = groupBounds(nodes.filter((n) => n.data.group === g.id));
        if (!box) return null;
        return <Frame key={g.id} group={g} box={box} startEditing={editing === g.id} onEditDone={onEditDone} />;
      })}
    </ViewportPortal>
  );
}

function Frame({
  group,
  box,
  startEditing,
  onEditDone,
}: {
  group: FlowGroup;
  box: { x: number; y: number; width: number; height: number };
  startEditing: boolean;
  onEditDone: () => void;
}) {
  const actions = useContext(GroupActionsContext)!;
  const zoom = useStore((s) => s.transform[2]);
  const [editing, setEditing] = useState(startEditing);
  const [title, setTitle] = useState(group.title);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  useEffect(() => setTitle(group.title), [group.title]);
  useEffect(() => {
    if (startEditing) setEditing(true);
  }, [startEditing]);

  const finish = () => {
    setEditing(false);
    onEditDone();
    const clean = title.trim();
    if (clean && clean !== group.title) actions.rename(group.id, clean);
    else setTitle(group.title);
  };

  return (
    <div
      className="group-frame"
      style={{
        transform: `translate(${box.x - PAD}px, ${box.y - PAD - HEADER}px)`,
        width: box.width + PAD * 2,
        height: box.height + PAD * 2 + HEADER,
      }}
    >
      <div
        className="group-frame-header nodrag nopan"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("button, input")) return;
          drag.current = { x: e.clientX, y: e.clientY, moved: false };
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            // Synthetic events can't capture the pointer; dragging still works while over the bar.
          }
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const dx = (e.clientX - drag.current.x) / zoom;
          const dy = (e.clientY - drag.current.y) / zoom;
          if (!dx && !dy) return;
          drag.current = { x: e.clientX, y: e.clientY, moved: true };
          actions.move(group.id, dx, dy);
        }}
        onPointerUp={() => {
          if (drag.current?.moved) actions.moved();
          drag.current = null;
        }}
        onDoubleClick={() => setEditing(true)}
        title="Drag to move the group. Double-click to rename it."
      >
        {editing ? (
          <input
            className="group-title-input"
            autoFocus
            value={title}
            aria-label="Group name"
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={finish}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                setTitle(group.title);
                setEditing(false);
                onEditDone();
              }
              e.stopPropagation();
            }}
          />
        ) : (
          <span className="group-title">{group.title || "Untitled group"}</span>
        )}
        <span className="group-frame-actions" data-export-hide>
          <button type="button" className="icon-button" title="Fold into one card" aria-label={`Fold ${group.title}`} onClick={() => actions.fold(group.id)}>
            <Icon name="chevron" size={14} />
          </button>
          <button type="button" className="icon-button" title="Ungroup (the steps stay)" aria-label={`Ungroup ${group.title}`} onClick={() => actions.ungroup(group.id)}>
            <Icon name="close" size={13} />
          </button>
        </span>
      </div>
    </div>
  );
}

/** A folded group on the canvas: one card standing in for all its steps. Click it to open it. */
function GroupCardImpl({ data }: NodeProps<GroupCardNode>) {
  const actions = useContext(GroupActionsContext);
  return (
    <div className="group-card">
      <Handle type="target" position={Position.Top} />
      <button type="button" className="group-card-body" onClick={() => actions?.unfold(data.groupId)} title="Open this group">
        <span className="group-card-stack" aria-hidden="true" />
        <span className="group-card-title">{data.title || "Untitled group"}</span>
        <span className="group-card-meta">
          {data.count} {data.count === 1 ? "step" : "steps"}
          {data.range && data.range[0] !== data.range[1] && `, ${data.range[0]} to ${data.range[1]}`}
        </span>
        <span className="group-card-kinds" aria-hidden="true">
          {data.kinds.map((k) => (
            <i key={k} data-kind={k}>
              <Icon name={k} size={11} />
            </i>
          ))}
        </span>
        <span className="group-card-open">
          Open <Icon name="chevron" size={12} />
        </span>
      </button>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

export const GroupCard = memo(GroupCardImpl);
