// Topic clustering from embeddings, in plain maths.
//
// An embedding turns a text into a point in space so that texts with similar MEANING land close together.
// "Cosine similarity" measures the angle between two points: 1 = same direction (same meaning), 0 = unrelated.
// The algorithm below is greedy centroid clustering: walk the items, put each into the nearest existing group if it is
// similar enough to that group's average ("centroid"), otherwise start a new group. The threshold is the one knob:
// higher = tighter, smaller groups. No model is trained and no API call is made, so it is cheap and fully testable.

export function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** Cosine similarity for any vectors (they need not be unit length). */
export function cosine(a: number[], b: number[]): number {
  const d = Math.sqrt(dot(a, a)) * Math.sqrt(dot(b, b));
  return d === 0 ? 0 : dot(a, b) / d;
}

function centroid(vectors: number[][]): number[] {
  const out = new Array(vectors[0].length).fill(0);
  for (const v of vectors) for (let i = 0; i < v.length; i++) out[i] += v[i] / vectors.length;
  return out;
}

export type Cluster = { members: number[]; centroid: number[]; cohesion: number };

/**
 * Group item indexes by meaning. Two passes: assign greedily, then re-assign every item to its nearest final
 * centroid, which removes most of the order-dependence of a single greedy pass.
 */
export function clusterVectors(vectors: number[][], threshold = 0.75): Cluster[] {
  if (vectors.length === 0) return [];
  let groups: { members: number[]; centroid: number[] }[] = [];
  vectors.forEach((v, i) => {
    let best = -1;
    let bestSim = threshold;
    groups.forEach((g, gi) => {
      const s = cosine(v, g.centroid);
      if (s >= bestSim) {
        bestSim = s;
        best = gi;
      }
    });
    if (best === -1) groups.push({ members: [i], centroid: v.slice() });
    else {
      groups[best].members.push(i);
      groups[best].centroid = centroid(groups[best].members.map((m) => vectors[m]));
    }
  });
  // second pass: settle every item into its nearest final centroid
  const final = groups.map((g) => g.centroid);
  const settled: number[][] = final.map(() => []);
  vectors.forEach((v, i) => {
    let best = 0;
    let bestSim = -2;
    final.forEach((c, gi) => {
      const s = cosine(v, c);
      if (s > bestSim) {
        bestSim = s;
        best = gi;
      }
    });
    settled[best].push(i);
  });
  groups = settled.filter((m) => m.length).map((members) => ({ members, centroid: centroid(members.map((m) => vectors[m])) }));
  return groups.map((g) => ({
    members: g.members,
    centroid: g.centroid,
    cohesion: g.members.reduce((a, m) => a + cosine(vectors[m], g.centroid), 0) / g.members.length,
  }));
}

/**
 * Subtract the average vector from every vector. Embedding models place all texts in a narrow cone, so raw cosine
 * similarities are all high ("everything is a bit like everything"). Centring removes that shared direction, which
 * leaves the differences that actually separate one theme from another.
 */
export function centerVectors(vectors: number[][]): number[][] {
  if (vectors.length === 0) return [];
  const mean = centroid(vectors);
  return vectors.map((v) => v.map((x, i) => x - mean[i]));
}
