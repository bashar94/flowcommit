import { createContext, memo, useContext } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  Position,
  getSmoothStepPath,
  useInternalNode,
  useReactFlow,
  type EdgeProps,
} from "@xyflow/react";
import type { ArrowEdge } from "../model.ts";

/** Which arrows belong to the highlighted path. When it's empty, nothing is dimmed. */
export const ArrowFocus = createContext<{ active: boolean; edges: Set<string> }>({ active: false, edges: new Set() });

export type ArrowData = { label: string; tone?: "yes" | "no" | "plain"; back?: boolean; backTo?: number };

const LOOP_GAP = 40;
const CORNER = 14;
const LABEL_OFFSET = 34;

/**
 * An arrow that's easy to follow:
 * - Yes and No branches are green and red, so a decision's paths are told apart at a glance.
 * - An arrow back up the flow (like "Try again") goes around the side of the steps as a dashed
 *   line, instead of cutting through them.
 * - Labels sit near where a branch starts, so it's clear which arrow they belong to.
 */
function FlowArrowImpl(props: EdgeProps<ArrowEdge>) {
  const { id, source, target, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, selected } = props;
  const data = props.data as ArrowData | undefined;
  const focus = useContext(ArrowFocus);
  const rf = useReactFlow();
  const s = useInternalNode(source);
  const t = useInternalNode(target);

  let path: string;
  let labelX: number;
  let labelY: number;

  if (data?.back && s && t) {
    // Go around the outside of both steps, on the side the arrow leaves from.
    const box = (n: NonNullable<typeof s>) => {
      const x = n.internals.positionAbsolute.x;
      return { left: x, right: x + (n.measured.width ?? 0) };
    };
    const a = box(s);
    const b = box(t);
    const goLeft = sourcePosition === Position.Left;
    const side = goLeft ? Math.min(a.left, b.left) - LOOP_GAP : Math.max(a.right, b.right) + LOOP_GAP;
    const start = sourcePosition === Position.Bottom ? [sourceX, sourceY + 18] : [sourceX, sourceY];
    const points: [number, number][] = [
      [sourceX, sourceY],
      ...(sourcePosition === Position.Bottom ? [start as [number, number]] : []),
      [side, start[1]],
      [side, targetY - 22],
      [targetX, targetY - 22],
      [targetX, targetY],
    ];
    path = rounded(points, CORNER);
    labelX = side;
    labelY = (start[1] + targetY - 22) / 2;
  } else {
    [path, labelX, labelY] = getSmoothStepPath({
      sourceX,
      sourceY,
      targetX,
      targetY,
      sourcePosition,
      targetPosition,
      borderRadius: CORNER,
      offset: 24,
    });
    // A branch leaving a diamond's corner gets its label just outside that corner, on the line,
    // so it's clear which branch it names and it never covers the question in the diamond.
    if (sourcePosition === Position.Left || sourcePosition === Position.Right) {
      labelX = sourceX + (sourcePosition === Position.Left ? -LABEL_OFFSET : LABEL_OFFSET);
      labelY = sourceY;
    }
  }

  const dim = focus.active && !focus.edges.has(id);
  const lit = focus.active && focus.edges.has(id);
  const tone = data?.back ? "back" : (data?.tone ?? "plain");
  const label = data?.label ?? "";

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        interactionWidth={18}
        className={`flow-arrow tone-${tone}${lit ? " is-lit" : ""}${selected ? " is-selected" : ""}`}
        style={{ opacity: dim ? 0.15 : 1 }}
      />
      {(label || data?.back) && (
        <EdgeLabelRenderer>
          <button
            type="button"
            className="arrow-label nodrag nopan"
            data-tone={tone}
            data-selected={selected || undefined}
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              opacity: dim ? 0.2 : 1,
            }}
            title={data?.back ? `Goes back to step ${data.backTo ?? ""}` : undefined}
            onClick={() =>
              rf.setEdges((es) => es.map((e) => ({ ...e, selected: e.id === id })))
            }
          >
            {data?.back && <span aria-hidden="true">↩ </span>}
            {label || (data?.back ? `Back to ${data.backTo ?? "earlier step"}` : "")}
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

/** Joins straight segments with rounded corners. */
function rounded(points: [number, number][], r: number): string {
  let d = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i - 1];
    const [x, y] = points[i];
    const [nx, ny] = points[i + 1];
    const inLen = Math.hypot(x - px, y - py);
    const outLen = Math.hypot(nx - x, ny - y);
    const k = Math.min(r, inLen / 2, outLen / 2);
    const ax = x - ((x - px) / (inLen || 1)) * k;
    const ay = y - ((y - py) / (inLen || 1)) * k;
    const bx = x + ((nx - x) / (outLen || 1)) * k;
    const by = y + ((ny - y) / (outLen || 1)) * k;
    d += ` L ${ax} ${ay} Q ${x} ${y} ${bx} ${by}`;
  }
  const last = points[points.length - 1];
  return `${d} L ${last[0]} ${last[1]}`;
}

export const FlowArrow = memo(FlowArrowImpl);
