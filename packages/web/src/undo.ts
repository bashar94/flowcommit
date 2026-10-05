import { useCallback, useEffect, useRef, useState } from "react";
import { serializeFlow } from "@flowcommit/shared";
import { fromCanvas, type ArrowEdge, type FlowMeta, type StepNode } from "./model.ts";

/**
 * Undo and redo for the canvas. A snapshot is taken once the design has been still for a
 * moment, so dragging a card or typing a word is one step, not hundreds.
 */

export type Snapshot = { meta: FlowMeta; nodes: StepNode[]; edges: ArrowEdge[] };

const SETTLE_MS = 350;
const MAX_STEPS = 100;

/** What's worth remembering: the design and layout, not selection or React Flow's measurements. */
const strip = (s: Snapshot): Snapshot => ({
  meta: s.meta,
  nodes: s.nodes.map(({ id, type, position, data }) => ({ id, type, position, data })),
  edges: s.edges.map(({ selected: _selected, ...e }) => e),
});
const textOf = (s: Snapshot) => serializeFlow(fromCanvas(s.meta, s.nodes, s.edges));

export function useUndo(current: Snapshot, ready: boolean, apply: (s: Snapshot) => void) {
  const latest = useRef(current);
  latest.current = current;
  const committed = useRef<{ snapshot: Snapshot; text: string } | null>(null);
  const past = useRef<Snapshot[]>([]);
  const future = useRef<Snapshot[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Set when the next change is an automatic follow-up (like laying cards out once they're
  // measured), which belongs to the step before it rather than being a step of its own.
  const amendNext = useRef(false);
  // Only drives whether the buttons are enabled.
  const [, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);

  const settle = useCallback(() => {
    clearTimeout(timer.current);
    const snapshot = strip(latest.current);
    const text = textOf(snapshot);
    if (!committed.current) {
      committed.current = { snapshot, text };
      return;
    }
    if (text === committed.current.text) {
      amendNext.current = false; // the follow-up changed nothing
      return;
    }
    if (amendNext.current) {
      amendNext.current = false;
      committed.current = { snapshot, text };
      return;
    }
    past.current = [...past.current.slice(-(MAX_STEPS - 1)), committed.current.snapshot];
    future.current = [];
    committed.current = { snapshot, text };
    bump();
  }, []);

  useEffect(() => {
    if (!ready) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(settle, SETTLE_MS);
    return () => clearTimeout(timer.current);
  }, [current.meta, current.nodes, current.edges, ready, settle]);

  const move = useCallback(
    (from: { current: Snapshot[] }, to: { current: Snapshot[] }) => {
      settle(); // a change still settling counts as its own step
      const target = from.current.pop();
      if (!target || !committed.current) return;
      to.current.push(committed.current.snapshot);
      committed.current = { snapshot: target, text: textOf(target) };
      apply(target);
      bump();
    },
    [apply, settle],
  );

  return {
    undo: useCallback(() => move(past, future), [move]),
    redo: useCallback(() => move(future, past), [move]),
    /** The next change joins the previous undo step instead of starting a new one. */
    amend: useCallback(() => {
      settle(); // anything still settling is its own step first
      amendNext.current = true;
    }, [settle]),
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
    /** Starts a fresh history, e.g. after loading another branch or project. */
    reset: useCallback(() => {
      clearTimeout(timer.current);
      past.current = [];
      future.current = [];
      committed.current = null;
      bump();
    }, []),
  };
}
