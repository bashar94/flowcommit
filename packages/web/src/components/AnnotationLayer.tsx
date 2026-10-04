import { forwardRef } from "react";
import type { Annotation, AnnotationColor } from "@flowcommit/shared";

/**
 * Draws annotation marks in the image's own pixel units. Colors and fonts are written out in
 * full rather than taken from CSS, because this same SVG is turned into the marked-up image
 * file that AI tools look at.
 */

export const MARK_COLORS: Record<AnnotationColor, string> = {
  red: "#e5484d",
  yellow: "#f5a524",
  blue: "#3e63dd",
  green: "#30a46c",
};

type Props = {
  width: number;
  height: number;
  annotations: Annotation[];
  /** A mark that is still being drawn. */
  draft?: Annotation | null;
  selectedId?: string | null;
  className?: string;
} & Omit<React.SVGProps<SVGSVGElement>, "ref">;

export const AnnotationLayer = forwardRef<SVGSVGElement, Props>(function AnnotationLayer(
  { width, height, annotations, draft, selectedId, className, ...rest },
  ref,
) {
  const size = Math.max(width, height);
  const stroke = Math.max(2, size / 260);
  const badge = Math.max(11, size / 52);
  const all = draft ? [...annotations, draft] : annotations;

  return (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={className}
      {...rest}
    >
      {all.map((a, i) => (
        <Mark
          key={a.id}
          a={a}
          n={i + 1}
          w={width}
          h={height}
          stroke={stroke}
          badge={badge}
          selected={a.id === selectedId}
          isDraft={a === draft}
        />
      ))}
    </svg>
  );
});

function Mark({
  a,
  n,
  w,
  h,
  stroke,
  badge,
  selected,
  isDraft,
}: {
  a: Annotation;
  n: number;
  w: number;
  h: number;
  stroke: number;
  badge: number;
  selected: boolean;
  isDraft: boolean;
}) {
  const color = MARK_COLORS[a.color];
  const pts = a.points.map(([x, y]) => [x * w, y * h] as const);
  const [p0, p1 = p0] = pts;

  const shape = (s: number, c: string, opacity = 1) => {
    switch (a.kind) {
      case "box": {
        const x = Math.min(p0[0], p1[0]);
        const y = Math.min(p0[1], p1[1]);
        return (
          <rect
            x={x}
            y={y}
            width={Math.abs(p1[0] - p0[0])}
            height={Math.abs(p1[1] - p0[1])}
            rx={s * 1.5}
            fill={c === color ? color : c === "transparent" ? "transparent" : "none"}
            fillOpacity={c === color ? 0.12 : 0}
            stroke={c}
            strokeWidth={s}
            opacity={opacity}
          />
        );
      }
      case "arrow": {
        const angle = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
        const head = s * 5;
        const tip = p1;
        const left = [tip[0] - head * Math.cos(angle - 0.45), tip[1] - head * Math.sin(angle - 0.45)];
        const right = [tip[0] - head * Math.cos(angle + 0.45), tip[1] - head * Math.sin(angle + 0.45)];
        // Stop the line short of the tip so its end doesn't poke through the arrowhead.
        const end = [tip[0] - head * 0.6 * Math.cos(angle), tip[1] - head * 0.6 * Math.sin(angle)];
        return (
          <g opacity={opacity}>
            <line x1={p0[0]} y1={p0[1]} x2={end[0]} y2={end[1]} stroke={c} strokeWidth={s} strokeLinecap="round" />
            <polygon points={`${tip[0]},${tip[1]} ${left[0]},${left[1]} ${right[0]},${right[1]}`} fill={c} stroke={c} strokeWidth={s / 2} strokeLinejoin="round" />
          </g>
        );
      }
      case "pen":
        return (
          <polyline
            points={pts.map((p) => p.join(",")).join(" ")}
            fill="none"
            stroke={c}
            strokeWidth={s * 1.2}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={opacity}
          />
        );
      case "pin":
        return null;
    }
  };

  const anchor = a.kind === "box" ? [Math.min(p0[0], p1[0]), Math.min(p0[1], p1[1])] : p0;
  const r = a.kind === "pin" ? badge * 1.1 : badge;
  // A pin is drawn like a map pin: the number floats above the spot, with a tail pointing at it,
  // so the spot itself stays visible. Near the top edge it hangs below instead.
  const pinLift = r * 2.1;
  const pinBelow = a.kind === "pin" && p0[1] - pinLift - r < 0;
  // Box badges sit just outside the corner so they never cover what the box points at.
  const bx = a.kind === "box" ? anchor[0] - badge * 0.35 : anchor[0];
  const by =
    a.kind === "box"
      ? anchor[1] - badge * 0.35
      : a.kind === "pin"
        ? p0[1] + (pinBelow ? pinLift : -pinLift)
        : anchor[1];

  return (
    <g data-id={a.id} style={{ cursor: isDraft ? undefined : "move" }}>
      {selected && shape(stroke * 3.2, "#ffffff", 0.85)}
      {shape(stroke, color)}
      {a.kind === "pin" && (
        <g>
          {selected && <circle cx={bx} cy={by} r={r + stroke * 2.2} fill="#ffffff" opacity={0.9} />}
          <path
            d={`M ${bx - r * 0.55} ${by + (pinBelow ? -r * 0.6 : r * 0.6)} L ${p0[0]} ${p0[1]} L ${bx + r * 0.55} ${by + (pinBelow ? -r * 0.6 : r * 0.6)} Z`}
            fill={color}
            stroke="#ffffff"
            strokeWidth={Math.max(1.5, stroke * 0.6)}
            strokeLinejoin="round"
          />
          <circle cx={p0[0]} cy={p0[1]} r={Math.max(2.5, stroke * 0.9)} fill="#ffffff" stroke={color} strokeWidth={Math.max(1.5, stroke * 0.6)} />
        </g>
      )}
      {(!isDraft || a.kind === "pin") && (
        <g>
          <circle cx={bx} cy={by} r={r} fill={color} stroke="#ffffff" strokeWidth={Math.max(2, stroke * 0.8)} />
          <text
            x={bx}
            y={by}
            dy="0.35em"
            textAnchor="middle"
            fontFamily="Helvetica, Arial, sans-serif"
            fontWeight="700"
            fontSize={r * 1.15}
            fill="#ffffff"
          >
            {n}
          </text>
        </g>
      )}
      {/* A wide invisible stroke makes thin marks easy to click. */}
      {a.kind !== "pin" && shape(Math.max(stroke * 6, 14), "transparent")}
    </g>
  );
}
