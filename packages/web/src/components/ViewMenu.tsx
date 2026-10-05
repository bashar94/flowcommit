import { useEffect, useRef, useState } from "react";
import { NODE_KINDS, NODE_KIND_INFO, type NodeKind } from "@flowcommit/shared";
import { Icon } from "../icons.tsx";

/** Details each viewer can show or hide on the cards. A per-viewer preference, kept in this browser. */
export const VIEW_DETAILS = [
  { key: "kind", label: "Step type names" },
  { key: "text", label: "Instructions" },
  { key: "media", label: "Images and links" },
  { key: "tags", label: "Tags" },
  { key: "build", label: "Build status" },
  { key: "arrows", label: "Arrow labels" },
  { key: "numbers", label: "Step numbers" },
  { key: "focus", label: "Highlight connected steps" },
  { key: "outline", label: "Outline" },
  { key: "legend", label: "Shape legend" },
] as const;

/** Options that change what's drawn, not which card details are hidden with CSS. */
const NOT_CSS = new Set<string>(["legend", "focus", "outline"]);

export type ViewDetail = (typeof VIEW_DETAILS)[number]["key"];
export type ViewOptions = Record<ViewDetail, boolean>;

const DETAILED: ViewOptions = {
  kind: true,
  text: true,
  media: true,
  tags: true,
  build: true,
  arrows: true,
  numbers: true,
  focus: true,
  outline: false,
  legend: false,
};
/** Shapes, titles and numbers, plus the arrow labels and outline that make the story readable. */
const SIMPLE: ViewOptions = {
  kind: false,
  text: false,
  media: false,
  tags: false,
  build: false,
  arrows: true,
  numbers: true,
  focus: true,
  outline: true,
  legend: true,
};

const STORAGE_KEY = "flowcommit.view";

export function useViewOptions() {
  const [options, setOptions] = useState<ViewOptions>(() => {
    try {
      return { ...DETAILED, ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") };
    } catch {
      return DETAILED;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(options));
    } catch {
      // Remembering the view is only a convenience.
    }
  }, [options]);
  /** Space-separated list of hidden details, for CSS (`[data-hide~="text"]`). */
  const hidden = VIEW_DETAILS.filter((d) => !NOT_CSS.has(d.key) && !options[d.key]).map((d) => d.key).join(" ");
  return { options, setOptions, hidden };
}

const same = (a: ViewOptions, b: ViewOptions) => VIEW_DETAILS.every((d) => a[d.key] === b[d.key]);

export function ViewMenu({
  options,
  onChange,
  onExport,
  shareTargets = [],
  onShare,
}: {
  options: ViewOptions;
  onChange: (o: ViewOptions) => void;
  /** Saves a picture of the flow. Leave it out where there's nothing to export. */
  onExport?: (format: "png" | "pdf") => void;
  /** Ways to share added by plugins, like a cloud share link. */
  shareTargets?: { id: string; label: string; description?: string }[];
  onShare?: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const preset = same(options, SIMPLE) ? "simple" : same(options, DETAILED) ? "detailed" : "custom";

  return (
    <div className="view-menu" ref={ref}>
      <button type="button" className="view-button" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name="eye" size={15} />
        View
        <Icon name="chevron" size={14} />
      </button>
      {open && (
        <div className="popover view-popover">
          <div className="segmented segmented-large" role="group" aria-label="Preset">
            <button type="button" aria-pressed={preset === "simple"} onClick={() => onChange(SIMPLE)}>
              Simple
            </button>
            <button type="button" aria-pressed={preset === "detailed"} onClick={() => onChange(DETAILED)}>
              Detailed
            </button>
          </div>
          <p className="inspector-note">
            Simple shows the shapes, titles and an outline, which is easiest for explaining the app to someone.
          </p>
          <ul className="view-options">
            {VIEW_DETAILS.map((d) => (
              <li key={d.key}>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={options[d.key]}
                    onChange={(e) => onChange({ ...options, [d.key]: e.target.checked })}
                  />
                  <span>{d.label}</span>
                </label>
              </li>
            ))}
          </ul>
          {onExport && (
            <div className="view-export">
              <p className="popover-title">Share a picture</p>
              <p className="inspector-note">Drawn the way you see it now, with the details you picked above.</p>
              <div className="sync-actions">
                <button type="button" className="button" onClick={() => { setOpen(false); onExport("png"); }}>
                  <Icon name="image" size={14} /> Download PNG
                </button>
                <button type="button" className="button" onClick={() => { setOpen(false); onExport("pdf"); }}>
                  <Icon name="download" size={14} /> Print or save as PDF
                </button>
                {onShare &&
                  shareTargets.map((t) => (
                    <button key={t.id} type="button" className="button" title={t.description} onClick={() => { setOpen(false); onShare(t.id); }}>
                      <Icon name="link" size={14} /> {t.label}
                    </button>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** A small drawing of each step type's shape, used in the legend. */
export function ShapeIcon({ kind }: { kind: NodeKind }) {
  const common = { fill: "var(--kind-soft)", stroke: "var(--kind)", strokeWidth: 1.5 };
  return (
    <svg viewBox="0 0 36 24" width="36" height="24" aria-hidden="true" data-kind={kind} className="shape-icon">
      {kind === "start" || kind === "end" ? (
        <rect x="2" y="5" width="32" height="14" rx="7" {...common} />
      ) : kind === "decision" ? (
        <polygon points="18,2 34,12 18,22 2,12" {...common} />
      ) : kind === "data" ? (
        <>
          <path d="M5 6v12c0 2 6 3.5 13 3.5S31 20 31 18V6" {...common} />
          <ellipse cx="18" cy="6" rx="13" ry="3.5" {...common} />
        </>
      ) : kind === "api" ? (
        <>
          <rect x="2" y="4" width="32" height="16" rx="2" {...common} />
          <path d="M7 4v16M29 4v16" stroke="var(--kind)" strokeWidth="1.5" />
        </>
      ) : kind === "screen" ? (
        <>
          <rect x="2" y="3" width="32" height="18" rx="3" {...common} />
          <path d="M2 8h32" stroke="var(--kind)" strokeWidth="1.5" />
        </>
      ) : (
        <rect x="2" y="4" width="32" height="16" rx="3" {...common} />
      )}
    </svg>
  );
}

export function Legend() {
  return (
    <aside className="legend-card" aria-label="What the shapes mean">
      <p className="legend-title">Shapes</p>
      <ul>
        {NODE_KINDS.map((k) => (
          <li key={k} data-kind={k}>
            <ShapeIcon kind={k} />
            <span>
              <strong>{NODE_KIND_INFO[k].label}</strong> {NODE_KIND_INFO[k].hint.toLowerCase()}
            </span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
