import { toPng } from "html-to-image";
import { getViewportForBounds, type Node, type ReactFlowInstance } from "@xyflow/react";

/** Room around the steps, with extra at the top for group titles. */
const PAD = { x: 56, top: 96, bottom: 56 };
/** Big flows are scaled down so the picture stays a reasonable size. */
const MAX_SIDE = 7000;

/** A picture of the whole flow, as a PNG data URL, drawn the way it looks on screen. */
export async function flowPicture(rf: ReactFlowInstance<Node>): Promise<string> {
  const nodes = rf.getNodes().filter((n) => !n.hidden);
  const bounds = rf.getNodesBounds(nodes);
  const box = {
    x: bounds.x - PAD.x,
    y: bounds.y - PAD.top,
    width: bounds.width + PAD.x * 2,
    height: bounds.height + PAD.top + PAD.bottom,
  };
  const scale = Math.min(1, MAX_SIDE / Math.max(box.width, box.height));
  const width = Math.round(box.width * scale);
  const height = Math.round(box.height * scale);
  const view = getViewportForBounds(box, width, height, 0.05, 1, 0);
  const viewport = document.querySelector<HTMLElement>(".react-flow__viewport");
  if (!viewport) throw new Error("The canvas isn't showing.");
  const paper = getComputedStyle(document.documentElement).getPropertyValue("--paper").trim() || "#ffffff";
  return toPng(viewport, {
    backgroundColor: paper,
    width,
    height,
    pixelRatio: 2,
    style: { width: `${width}px`, height: `${height}px`, transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` },
    // Buttons on the cards (like the + for the next step) aren't part of the picture.
    filter: (el) => !(el instanceof HTMLElement && el.dataset.exportHide !== undefined),
  });
}

export function fileName(name: string, ext: string) {
  const base = name.trim().replace(/[^\w\- ]+/g, "").replace(/\s+/g, "-").toLowerCase() || "flow";
  return `${base}-flow.${ext}`;
}

export function download(dataUrl: string, name: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = name;
  a.click();
}
