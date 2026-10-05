/**
 * Places steps top to bottom in rows, the way people read a flowchart:
 * 1. Walk the flow from its start steps. An arrow that points back to a step already on the
 *    current path (like "Try again") is a loop, and is ignored for placement.
 * 2. Each step goes one row below the furthest step that leads into it.
 * 3. Within a row, steps sit under the steps that lead into them, which keeps arrows from crossing.
 *    Steps in the same group sit side by side, so the group's frame doesn't take in other steps.
 */

export const LAYOUT = { cardWidth: 248, rowHeight: 176, cardHeight: 112, rowGap: 64, columnGap: 72 } as const;

type Edge = { source: string; target: string };

/**
 * The rows of a flow, top to bottom, each in left-to-right order. Shared by the step layout and
 * the layout of whole parts.
 */
function orderedRows(
  ids: string[],
  edges: Edge[],
  roots: string[],
  groups: Map<string, string>,
): { rows: string[][]; row: Map<string, number>; parents: Map<string, string[]>; slot: Map<string, number> } {
  const known = new Set(ids);
  const out = new Map(ids.map((id) => [id, [] as string[]]));
  for (const e of edges) {
    if (known.has(e.source) && known.has(e.target) && e.source !== e.target) out.get(e.source)!.push(e.target);
  }

  // Depth-first walk to find loop-back arrows and the order steps are first reached.
  const order: string[] = [];
  const state = new Map<string, "open" | "done">();
  const forward = new Map(ids.map((id) => [id, [] as string[]]));
  const visit = (id: string) => {
    state.set(id, "open");
    order.push(id);
    for (const next of out.get(id)!) {
      if (state.get(next) === "open") continue; // a loop back up the flow
      forward.get(id)!.push(next);
      if (!state.has(next)) visit(next);
    }
    state.set(id, "done");
  };
  const hasIncoming = new Set(edges.filter((e) => known.has(e.source)).map((e) => e.target));
  const starts = [...roots.filter((r) => known.has(r)), ...ids.filter((id) => !hasIncoming.has(id))];
  for (const id of [...starts, ...ids]) if (!state.has(id)) visit(id);

  // Longest path over the forward arrows gives each step its row.
  const parents = new Map(ids.map((id) => [id, [] as string[]]));
  for (const [from, targets] of forward) for (const to of targets) parents.get(to)!.push(from);
  const row = new Map<string, number>();
  const rowOf = (id: string): number => {
    if (row.has(id)) return row.get(id)!;
    row.set(id, 0); // guards against any cycle the walk missed
    const r = Math.max(-1, ...parents.get(id)!.map(rowOf)) + 1;
    row.set(id, r);
    return r;
  };
  ids.forEach(rowOf);

  const rows: string[][] = [];
  for (const id of order) (rows[row.get(id)!] ??= []).push(id);

  // Order each row by where its parents sit, so children line up under them.
  const slot = new Map<string, number>();
  const ordered: string[][] = [];
  for (const r of rows) {
    if (!r) {
      ordered.push([]);
      continue;
    }
    const weight = (id: string) => {
      const ps = parents.get(id)!.filter((p) => slot.has(p));
      return ps.length ? ps.reduce((sum, p) => sum + slot.get(p)!, 0) / ps.length : Number.POSITIVE_INFINITY;
    };
    const items = r.map((id, i) => ({ id, w: weight(id), i, group: groups.get(id) }));
    // A group is placed where its steps in this row would be on average, and they stay together.
    const groupWeight = new Map<string, number>();
    for (const g of new Set(items.map((x) => x.group).filter((g): g is string => !!g))) {
      const ws = items.filter((x) => x.group === g && Number.isFinite(x.w)).map((x) => x.w);
      groupWeight.set(g, ws.length ? ws.reduce((a, b) => a + b, 0) / ws.length : Number.POSITIVE_INFINITY);
    }
    const key = (x: (typeof items)[number]) => (x.group ? groupWeight.get(x.group)! : x.w);
    const sorted = items.sort(
      (a, b) =>
        key(a) - key(b) ||
        (a.group ?? "").localeCompare(b.group ?? "") ||
        (a.w === b.w ? a.i - b.i : a.w - b.w),
    );
    const width = sorted.length - 1;
    sorted.forEach(({ id }, i) => slot.set(id, i - width / 2));
    ordered.push(sorted.map((x) => x.id));
  }
  return { rows: ordered, row, parents, slot };
}

export function layoutFlow(
  ids: string[],
  edges: Edge[],
  roots: string[] = [],
  /** Measured card heights, when known, so tall cards (like screens with images) get room. */
  heights: Map<string, number> = new Map(),
  /** The group each step is in, if any. */
  groups: Map<string, string> = new Map(),
): Map<string, { x: number; y: number }> {
  const { rows, row, slot } = orderedRows(ids, edges, roots, groups);

  // Each row starts below the tallest card of the row above it.
  const rowTop: number[] = [];
  let top = 0;
  rows.forEach((r, i) => {
    rowTop[i] = top;
    const tallest = Math.max(...r.map((id) => heights.get(id) ?? LAYOUT.cardHeight));
    top += Math.max(tallest + LAYOUT.rowGap, LAYOUT.rowHeight);
  });

  const step = LAYOUT.cardWidth + LAYOUT.columnGap;
  const positions = new Map<string, { x: number; y: number }>();
  for (const id of ids) {
    positions.set(id, {
      x: Math.round(slot.get(id)! * step - LAYOUT.cardWidth / 2),
      y: rowTop[row.get(id)!] ?? 0,
    });
  }
  return positions;
}

/** Room between blocks: parts of the app, or steps that aren't in a part. */
export const BLOCK_GAP = { column: 96, row: 88 } as const;

/**
 * Lays out blocks of different sizes (whole parts of the app, and loose steps) in rows, the
 * same way steps are: each below what leads into it, and centered under it where there's room.
 * Returns each block's top-left corner. Blocks never overlap.
 */
export function layoutBlocks(
  ids: string[],
  edges: Edge[],
  roots: string[],
  sizes: Map<string, { width: number; height: number }>,
): Map<string, { x: number; y: number }> {
  const { rows, parents } = orderedRows(ids, edges, roots, new Map());
  const size = (id: string) => sizes.get(id) ?? { width: LAYOUT.cardWidth, height: LAYOUT.cardHeight };
  const center = new Map<string, number>();
  const positions = new Map<string, { x: number; y: number }>();
  let top = 0;
  for (const r of rows) {
    if (!r.length) continue;
    // Where each block would like to be: centered under the blocks that lead into it.
    const wanted = r.map((id) => {
      const ps = parents.get(id)!.filter((p) => center.has(p));
      return ps.length ? ps.reduce((sum, p) => sum + center.get(p)!, 0) / ps.length : 0;
    });
    // Place left to right without overlapping, then shift the row back toward where it wanted to be.
    const lefts: number[] = [];
    let right = -Infinity;
    r.forEach((id, i) => {
      const w = size(id).width;
      const left = Math.max(wanted[i] - w / 2, right + BLOCK_GAP.column);
      lefts.push(left);
      right = left + w;
    });
    const shift = r.reduce((sum, id, i) => sum + (wanted[i] - (lefts[i] + size(id).width / 2)), 0) / r.length;
    r.forEach((id, i) => {
      const x = Math.round(lefts[i] + shift);
      positions.set(id, { x, y: Math.round(top) });
      center.set(id, x + size(id).width / 2);
    });
    top += Math.max(...r.map((id) => size(id).height)) + BLOCK_GAP.row;
  }
  return positions;
}
