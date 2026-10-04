import { NODE_KINDS, NODE_KIND_INFO, type NodeKind } from "@flowcommit/shared";
import { Icon } from "../icons.tsx";

export const KIND_DRAG_TYPE = "application/x-flowcommit-kind";

type Props = { disabled?: boolean; onAdd: (kind: NodeKind) => void };

/** The floating toolbar at the bottom of the canvas. Click a type to add it, or drag it into place. */
export function Palette({ disabled, onAdd }: Props) {
  return (
    <nav className="dock" aria-label="Add a step">
      {NODE_KINDS.map((kind) => (
        <button
          key={kind}
          type="button"
          className="dock-item"
          data-kind={kind}
          disabled={disabled}
          draggable={!disabled}
          onDragStart={(e) => {
            e.dataTransfer.setData(KIND_DRAG_TYPE, kind);
            e.dataTransfer.effectAllowed = "copy";
          }}
          onClick={() => onAdd(kind)}
        >
          <span className="dock-icon">
            <Icon name={kind} size={16} />
          </span>
          <span className="dock-label">{NODE_KIND_INFO[kind].label}</span>
          <span className="dock-tip" role="tooltip">
            {NODE_KIND_INFO[kind].hint}
          </span>
        </button>
      ))}
    </nav>
  );
}
