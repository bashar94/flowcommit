import type { Annotation } from "./flow.ts";

/**
 * Turns marks on an image into words, because an AI agent in a terminal can't see where
 * someone pointed. Positions use a simple 3×3 grid plus percentages, e.g.
 * "Box around the top left (x 5–30%, y 2–12%)".
 */

const pct = (v: number) => `${Math.round(Math.min(1, Math.max(0, v)) * 100)}%`;

function area(x: number, y: number): string {
  const col = x < 1 / 3 ? "left" : x > 2 / 3 ? "right" : "center";
  const row = y < 1 / 3 ? "top" : y > 2 / 3 ? "bottom" : "middle";
  if (row === "middle" && col === "center") return "the middle";
  if (row === "middle") return `the middle ${col}`;
  if (col === "center") return `the ${row} center`;
  return `the ${row} ${col}`;
}

function bounds(points: [number, number][]) {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return { x1: Math.min(...xs), x2: Math.max(...xs), y1: Math.min(...ys), y2: Math.max(...ys) };
}

export function describeAnnotation(a: Annotation): string {
  const [first, second] = a.points;
  switch (a.kind) {
    case "pin":
      return `Pin at ${area(first[0], first[1])} (x ${pct(first[0])}, y ${pct(first[1])})`;
    case "arrow": {
      const to = second ?? first;
      return `Arrow pointing to ${area(to[0], to[1])} (x ${pct(to[0])}, y ${pct(to[1])}), drawn from ${area(first[0], first[1])}`;
    }
    case "box":
    case "pen": {
      const b = bounds(a.points);
      const what = a.kind === "box" ? "Box around" : "Drawing over";
      return `${what} ${area((b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2)} (x ${pct(b.x1)}–${pct(b.x2)}, y ${pct(b.y1)}–${pct(b.y2)})`;
    }
  }
}

/** The notes as a numbered list. The numbers match the badges drawn on the image. */
export function describeAnnotations(list: Annotation[]): string[] {
  return list.map((a, i) => `${i + 1}. ${describeAnnotation(a)}: ${a.note.trim() || "(no note)"}`);
}
