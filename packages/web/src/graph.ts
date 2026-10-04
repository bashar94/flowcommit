/**
 * Places commits in lanes for a branch graph, the way Git tools draw history: newest at the
 * top, each line of work in its own column, merges and branch-offs joining the columns.
 */

export type GraphInput = { sha: string; parents: string[] };
export type PlacedCommit<T extends GraphInput> = T & { lane: number; row: number };
export type GraphLine = { from: { lane: number; row: number }; to: { lane: number; row: number }; merge: boolean };

export function layoutGraph<T extends GraphInput>(commits: T[]): { placed: PlacedCommit<T>[]; lines: GraphLine[]; lanes: number } {
  const known = new Set(commits.map((c) => c.sha));
  // Each lane holds the commit it is waiting to reach next, or null when it's free.
  const lanes: (string | null)[] = [];
  const placed: PlacedCommit<T>[] = [];
  const firstFree = () => {
    const i = lanes.indexOf(null);
    return i === -1 ? lanes.push(null) - 1 : i;
  };

  commits.forEach((c, row) => {
    let lane = lanes.indexOf(c.sha);
    if (lane === -1) lane = firstFree();
    // Other lanes waiting for this same commit end here: their lines join this one.
    lanes.forEach((s, i) => {
      if (s === c.sha && i !== lane) lanes[i] = null;
    });
    const parents = c.parents.filter((p) => known.has(p));
    lanes[lane] = parents[0] ?? null;
    for (const p of parents.slice(1)) if (!lanes.includes(p)) lanes[firstFree()] = p;
    placed.push({ ...c, lane, row });
  });

  const where = new Map(placed.map((c) => [c.sha, c]));
  const lines: GraphLine[] = [];
  for (const c of placed) {
    c.parents.forEach((p, i) => {
      const parent = where.get(p);
      if (parent) lines.push({ from: { lane: c.lane, row: c.row }, to: { lane: parent.lane, row: parent.row }, merge: i > 0 });
    });
  }
  return { placed, lines, lanes: Math.max(1, ...placed.map((c) => c.lane + 1)) };
}
