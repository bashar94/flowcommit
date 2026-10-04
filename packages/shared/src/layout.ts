/**
 * Places steps top to bottom in rows, the way people read a flowchart:
 * 1. Walk the flow from its start steps. An arrow that points back to a step already on the
 *    current path (like "Try again") is a loop, and is ignored for placement.
 * 2. Each step goes one row below the furthest step that leads into it.
 * 3. Within a row, steps sit under the steps that lead into them, which keeps arrows from crossing.
 */

export const LAYOUT = { cardWidth: 248, rowHeight: 176, cardHeight: 112, rowGap: 64, columnGap: 72 } as const;

export function layoutFlow(
  ids: string[],
  edges: { source: string; target: string }[],
  roots: string[] = [],
  /** Measured card heights, when known, so tall cards (like screens with images) get room. */
  heights: Map<string, number> = new Map(),
): Map<string, { x: number; y: number }> {
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
  const hasIncoming = new Set(edges.map((e) => e.target));
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
  for (const r of rows) {
    if (!r) continue;
    const weight = (id: string) => {
      const ps = parents.get(id)!.filter((p) => slot.has(p));
      return ps.length ? ps.reduce((sum, p) => sum + slot.get(p)!, 0) / ps.length : Number.POSITIVE_INFINITY;
    };
    const sorted = r
      .map((id, i) => ({ id, w: weight(id), i }))
      .sort((a, b) => (a.w === b.w ? a.i - b.i : a.w - b.w));
    const width = sorted.length - 1;
    sorted.forEach(({ id }, i) => slot.set(id, i - width / 2));
  }

  // Each row starts below the tallest card of the row above it.
  const rowTop: number[] = [];
  let top = 0;
  rows.forEach((r, i) => {
    rowTop[i] = top;
    const tallest = Math.max(...(r ?? []).map((id) => heights.get(id) ?? LAYOUT.cardHeight));
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
