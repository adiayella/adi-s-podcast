import { describe, expect, it } from "vitest";
import { clusterVectors, cosine } from "./cluster";
import { normalizeVector } from "@/lib/gemini";

describe("cosine similarity", () => {
  it("is 1 for the same direction, 0 for unrelated, -1 for opposite", () => {
    expect(cosine([1, 0], [2, 0])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 3])).toBeCloseTo(0);
    expect(cosine([1, 0], [-1, 0])).toBeCloseTo(-1);
  });
  it("is 0 rather than NaN for a zero vector", () => {
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });
});

describe("clustering by meaning", () => {
  // three "AI" points, two "real estate" points, one loner, in 3-D
  const ai = [[1, 0.1, 0], [0.9, 0.2, 0.05], [1, 0, 0.1]];
  const re = [[0, 1, 0.1], [0.05, 0.9, 0.2]];
  const loner = [[0, 0, 1]];
  const vectors = [...ai, ...re, ...loner];

  it("groups close points and separates distant ones", () => {
    const groups = clusterVectors(vectors, 0.9).map((g) => g.members.sort());
    expect(groups).toContainEqual([0, 1, 2]);
    expect(groups).toContainEqual([3, 4]);
    expect(groups).toContainEqual([5]);
  });
  it("does not depend on the order the items arrive in", () => {
    const shuffled = [vectors[3], vectors[0], vectors[5], vectors[1], vectors[4], vectors[2]];
    const sizes = clusterVectors(shuffled, 0.9).map((g) => g.members.length).sort();
    expect(sizes).toEqual([1, 2, 3]);
  });
  it("a higher threshold gives smaller, tighter groups", () => {
    expect(clusterVectors(vectors, 0.999).length).toBeGreaterThan(clusterVectors(vectors, 0.5).length);
  });
  it("reports cohesion between 0 and 1 and handles empty input", () => {
    for (const g of clusterVectors(vectors, 0.9)) expect(g.cohesion).toBeGreaterThan(0.9);
    expect(clusterVectors([], 0.8)).toEqual([]);
  });
});

describe("vector normalisation", () => {
  it("rescales to unit length", () => {
    const v = normalizeVector([3, 4]);
    expect(Math.hypot(...v)).toBeCloseTo(1);
  });
});

import { centerVectors } from "./cluster";
describe("centring", () => {
  it("removes a shared direction so unrelated items stop looking similar", () => {
    // everything points mostly along x (the shared "cone"); only the small y difference separates the topics
    const v = [[10, 1], [10, 1.1], [10, -1], [10, -1.1]];
    expect(cosine(v[0], v[2])).toBeGreaterThan(0.95); // raw: looks identical
    const c = centerVectors(v);
    expect(cosine(c[0], c[2])).toBeLessThan(-0.9); // centred: clearly different
    expect(cosine(c[0], c[1])).toBeGreaterThan(0.9);
  });
});
