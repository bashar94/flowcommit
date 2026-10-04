import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ANNOTATION_COLORS, type Annotation, type AnnotationColor, type AnnotationKind } from "@flowcommit/shared";
import { api } from "../api.ts";
import { newId } from "../model.ts";
import { Icon } from "../icons.tsx";
import { AnnotationLayer, MARK_COLORS } from "./AnnotationLayer.tsx";

type Props = {
  imageUrl: string;
  imageName: string;
  initial: Annotation[];
  /** `annotatedSrc` is the uploaded marked-up copy, or undefined when every mark was removed. */
  onSave: (annotations: Annotation[], annotatedSrc: string | undefined) => void;
  onClose: () => void;
};

const TOOLS: { kind: AnnotationKind; label: string; key: string; hint: string }[] = [
  { kind: "box", label: "Box", key: "B", hint: "Drag a box around an area" },
  { kind: "arrow", label: "Arrow", key: "A", hint: "Drag from where the arrow starts to what it points at" },
  { kind: "pin", label: "Pin", key: "P", hint: "Click a spot to pin a note to it" },
  { kind: "pen", label: "Draw", key: "D", hint: "Draw freely, like circling something" },
];

const TOOL_ICON = { box: "end", arrow: "arrowRight", pin: "pin", pen: "pen" } as const;
const COLOR_NAME: Record<AnnotationColor, string> = { red: "Red", yellow: "Yellow", blue: "Blue", green: "Green" };

/** The marked-up file is capped so huge screenshots don't bloat the project. */
const MAX_EXPORT_SIDE = 2400;
const MIN_SIZE = 0.012;

type Drag =
  | { type: "draw"; mark: Annotation }
  | { type: "move"; id: string; start: [number, number]; original: Annotation["points"] };

/**
 * Lets people point at exactly what they mean on a screenshot or mockup: boxes, arrows, pins
 * and freehand marks, each numbered with a note. Saving also makes a marked-up copy of the
 * image, so AI tools see the numbers next to the written notes.
 */
export function Annotator({ imageUrl, imageName, initial, onSave, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const exportRef = useRef<SVGSVGElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const noteRefs = useRef(new Map<string, HTMLTextAreaElement>());
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [marks, setMarks] = useState<Annotation[]>(initial);
  const [tool, setTool] = useState<AnnotationKind>("box");
  const [color, setColor] = useState<AnnotationColor>("red");
  const [selected, setSelected] = useState<string | null>(null);
  // The drag lives in a ref because pointer events can arrive faster than React re-renders;
  // the state copy only drives what's drawn on screen.
  const dragRef = useRef<Drag | null>(null);
  const [drag, setDragState] = useState<Drag | null>(null);
  const setDrag = (next: Drag | null) => {
    dragRef.current = next;
    setDragState(next);
  };
  const [past, setPast] = useState<Annotation[][]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);

  const dirty = JSON.stringify(marks) !== JSON.stringify(initial);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  // Put the cursor in a new mark's note, so people can type what they mean right away.
  useEffect(() => {
    if (!focusId) return;
    noteRefs.current.get(focusId)?.focus();
    setFocusId(null);
  }, [focusId, marks]);

  const remember = useCallback(() => setPast((p) => [...p.slice(-49), marks]), [marks]);

  const undo = useCallback(() => {
    setPast((p) => {
      if (!p.length) return p;
      setMarks(p[p.length - 1]);
      setSelected(null);
      return p.slice(0, -1);
    });
  }, []);

  const remove = useCallback(
    (id: string) => {
      remember();
      setMarks((ms) => ms.filter((m) => m.id !== id));
      setSelected((s) => (s === id ? null : s));
    },
    [remember],
  );

  const point = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = svgRef.current!.getBoundingClientRect();
    return [
      Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    ];
  };

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    e.preventDefault(); // no text selection or focus change while drawing
    const p = point(e);
    const hit = (e.target as Element).closest("[data-id]")?.getAttribute("data-id");
    try {
      e.currentTarget.setPointerCapture(e.pointerId); // keep drawing even if the pointer leaves the image
    } catch {
      // Some pointers (like stylus hover or synthetic events) can't be captured; drawing still works.
    }
    if (hit && tool !== "pen") {
      const mark = marks.find((m) => m.id === hit)!;
      setSelected(hit);
      remember();
      setDrag({ type: "move", id: hit, start: p, original: mark.points });
      return;
    }
    // Every mark is added when the pointer is released, so focus can move to its note box.
    const mark: Annotation = { id: newId("m"), kind: tool, color, points: tool === "box" || tool === "arrow" ? [p, p] : [p], note: "" };
    setSelected(null);
    setDrag({ type: "draw", mark });
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const p = point(e);
    if (drag.type === "move") {
      const dx = p[0] - drag.start[0];
      const dy = p[1] - drag.start[1];
      setMarks((ms) =>
        ms.map((m) =>
          m.id === drag.id
            ? { ...m, points: drag.original.map(([x, y]) => [clamp(x + dx), clamp(y + dy)] as [number, number]) }
            : m,
        ),
      );
      return;
    }
    const m = drag.mark;
    if (m.kind === "pin") {
      setDrag({ type: "draw", mark: { ...m, points: [p] } });
    } else if (m.kind === "pen") {
      const last = m.points[m.points.length - 1];
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) > 0.003) setDrag({ type: "draw", mark: { ...m, points: [...m.points, p] } });
    } else {
      setDrag({ type: "draw", mark: { ...m, points: [m.points[0], p] } });
    }
  };

  const onPointerUp = () => {
    const drag = dragRef.current;
    if (drag?.type === "draw") {
      const m = drag.mark;
      const [a, b = a] = m.points;
      const big =
        m.kind === "pin" ||
        (m.kind === "pen" ? m.points.length > 2 : Math.abs(b[0] - a[0]) > MIN_SIZE || Math.abs(b[1] - a[1]) > MIN_SIZE);
      if (big) {
        remember();
        setMarks((ms) => [...ms, m]);
        setSelected(m.id);
        setFocusId(m.id);
      }
    }
    setDrag(null);
  };

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const kept = marks.map((m) => ({ ...m, note: m.note.trim() }));
      if (kept.length === 0) {
        onSave([], undefined);
        return;
      }
      const blob = await renderMarkedUp(imgRef.current!, exportRef.current!);
      const file = new File([blob], `${imageName.replace(/\.[^.]+$/, "")}-marked.png`, { type: "image/png" });
      const { src } = await api.uploadAsset(file);
      onSave(kept, src);
    } catch (err) {
      setError((err as Error).message || "Couldn't save the marked-up image. Try again.");
      setSaving(false);
    }
  };

  const close = () => {
    if (dirty && !confirmDiscard) setConfirmDiscard(true);
    else onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !typing) {
        e.preventDefault();
        undo();
        return;
      }
      if (typing) return;
      const t = TOOLS.find((x) => x.key.toLowerCase() === e.key.toLowerCase());
      if (t && !e.metaKey && !e.ctrlKey) setTool(t.kind);
      if ((e.key === "Delete" || e.key === "Backspace") && selected) {
        e.preventDefault();
        remove(selected);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, remove, selected]);

  const activeTool = TOOLS.find((t) => t.kind === tool)!;

  return (
    <dialog
      ref={dialogRef}
      className="annotator"
      aria-labelledby="annotator-title"
      onCancel={(e) => {
        e.preventDefault();
        if (selected) setSelected(null);
        else close();
      }}
    >
      <header className="annotator-head">
        <div>
          <h2 id="annotator-title" className="dialog-title">
            Mark up the image
          </h2>
          <p className="inspector-note">
            Point at exactly what you mean, then write what should change. The AI builder gets the numbered marks and
            your notes.
          </p>
        </div>
        <div className="annotator-actions">
          {confirmDiscard ? (
            <>
              <span className="inspector-note">Discard your changes?</span>
              <button type="button" className="button-danger" onClick={onClose}>
                Discard
              </button>
              <button type="button" className="button" onClick={() => setConfirmDiscard(false)}>
                Keep editing
              </button>
            </>
          ) : (
            <>
              <button type="button" className="button-quiet" onClick={close} disabled={saving}>
                Cancel
              </button>
              <button type="button" className="button-primary" onClick={save} disabled={saving || !size}>
                {saving ? "Saving…" : "Save marks"}
              </button>
            </>
          )}
        </div>
      </header>

      <div className="annotator-body">
        <div className="annotator-tools" role="toolbar" aria-label="Marking tools">
          {TOOLS.map((t) => (
            <button
              key={t.kind}
              type="button"
              className="tool"
              aria-pressed={tool === t.kind}
              title={`${t.hint} (${t.key})`}
              onClick={() => setTool(t.kind)}
            >
              <Icon name={TOOL_ICON[t.kind]} size={18} />
              <span>{t.label}</span>
              <kbd>{t.key}</kbd>
            </button>
          ))}
          <span className="tool-divider" />
          <div className="swatches" role="radiogroup" aria-label="Color">
            {ANNOTATION_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                aria-label={COLOR_NAME[c]}
                title={COLOR_NAME[c]}
                className="swatch"
                style={{ background: MARK_COLORS[c] }}
                onClick={() => {
                  setColor(c);
                  if (selected) {
                    remember();
                    setMarks((ms) => ms.map((m) => (m.id === selected ? { ...m, color: c } : m)));
                  }
                }}
              />
            ))}
          </div>
          <span className="tool-divider" />
          <button type="button" className="tool" onClick={undo} disabled={!past.length} title="Undo (⌘Z)">
            <Icon name="undo" size={18} />
            <span>Undo</span>
          </button>
        </div>

        <div className="annotator-stage">
          <p className="annotator-hint">{activeTool.hint}</p>
          <div className="annotator-canvas" data-tool={tool}>
            <img
              ref={imgRef}
              src={imageUrl}
              alt=""
              draggable={false}
              onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            />
            {size && (
              <AnnotationLayer
                ref={svgRef}
                className="annotator-svg"
                width={size.w}
                height={size.h}
                annotations={marks}
                draft={drag?.type === "draw" ? drag.mark : null}
                selectedId={selected}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
              />
            )}
          </div>
          {/* The same marks without the selection outline, used to make the marked-up copy. */}
          {size && (
            <AnnotationLayer ref={exportRef} width={size.w} height={size.h} annotations={marks} className="annotator-export" aria-hidden="true" />
          )}
        </div>

        <aside className="annotator-notes" aria-label="Notes">
          <h3 className="dialog-subtitle">Notes</h3>
          {marks.length === 0 ? (
            <p className="inspector-note">
              No marks yet. Draw a box around something on the image, then say what should change, like "make this
              button bigger" or "use our brand blue here".
            </p>
          ) : (
            <ol className="note-list">
              {marks.map((m, i) => (
                <li key={m.id} data-selected={m.id === selected || undefined} onClick={() => setSelected(m.id)}>
                  <span className="note-badge" style={{ background: MARK_COLORS[m.color] }}>
                    {i + 1}
                  </span>
                  <textarea
                    ref={(el) => {
                      if (el) noteRefs.current.set(m.id, el);
                      else noteRefs.current.delete(m.id);
                    }}
                    rows={2}
                    value={m.note}
                    placeholder="What should change here?"
                    aria-label={`Note ${i + 1}`}
                    onFocus={() => setSelected(m.id)}
                    onChange={(e) => setMarks((ms) => ms.map((x) => (x.id === m.id ? { ...x, note: e.target.value } : x)))}
                  />
                  <button type="button" className="icon-button" aria-label={`Remove mark ${i + 1}`} onClick={() => remove(m.id)}>
                    <Icon name="close" size={14} />
                  </button>
                </li>
              ))}
            </ol>
          )}
          {error && (
            <p className="inspector-error" role="alert">
              {error}
            </p>
          )}
        </aside>
      </div>
    </dialog>
  );
}

const clamp = (v: number) => Math.min(1, Math.max(0, v));

/** Draws the image and the marks onto one canvas and returns it as a PNG. */
async function renderMarkedUp(img: HTMLImageElement, svg: SVGSVGElement): Promise<Blob> {
  const scale = Math.min(1, MAX_EXPORT_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, w, h);

  const markup = new XMLSerializer().serializeToString(svg);
  const url = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml" }));
  try {
    const overlay = new Image();
    await new Promise<void>((resolve, reject) => {
      overlay.onload = () => resolve();
      overlay.onerror = () => reject(new Error("Couldn't draw the marks onto the image."));
      overlay.src = url;
    });
    ctx.drawImage(overlay, 0, 0, w, h);
  } finally {
    URL.revokeObjectURL(url);
  }
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't create the marked-up image."))), "image/png"),
  );
}
