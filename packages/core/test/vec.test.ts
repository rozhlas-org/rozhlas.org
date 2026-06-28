import { test, expect } from "bun:test";

// meanPool imports core, which opens the DB on load — point it at a throwaway file.
process.env.DATABASE_PATH = "/tmp/rozhlas-vec-test.db";
const { meanPool } = await import("@rozhlas/core");

const f = (...xs: number[]) => Float32Array.from(xs);
const norm = (v: Float32Array) => Math.sqrt([...v].reduce((s, x) => s + x * x, 0));

test("empty input → null", () => {
  expect(meanPool([], 3)).toBeNull();
});

test("single unit vector → itself (unit length)", () => {
  const out = meanPool([f(1, 0, 0)], 3)!;
  expect(out[0]!).toBeCloseTo(1, 6);
  expect(out[1]!).toBeCloseTo(0, 6);
  expect(norm(out)).toBeCloseTo(1, 6);
});

test("mean of two orthogonal unit vectors → renormalized centroid (unit length)", () => {
  const out = meanPool([f(1, 0), f(0, 1)], 2)!;
  expect(out[0]!).toBeCloseTo(Math.SQRT1_2, 6); // 0.7071…
  expect(out[1]!).toBeCloseTo(Math.SQRT1_2, 6);
  expect(norm(out)).toBeCloseTo(1, 6);
});

test("identical vectors → that direction, unit length", () => {
  const out = meanPool([f(0, 1, 0), f(0, 1, 0), f(0, 1, 0)], 3)!;
  expect(out[1]!).toBeCloseTo(1, 6);
  expect(norm(out)).toBeCloseTo(1, 6);
});

test("opposing vectors that cancel to zero → null (no direction)", () => {
  expect(meanPool([f(1, 0), f(-1, 0)], 2)).toBeNull();
});

test("renormalize is monotonic in cosine (closer vectors pool nearer the shared direction)", () => {
  const tight = meanPool([f(1, 0), f(0.9, 0.436)], 2)!; // ~26° apart
  const wide = meanPool([f(1, 0), f(0.5, 0.866)], 2)!; // 60° apart
  expect(norm(tight)).toBeCloseTo(1, 6);
  expect(norm(wide)).toBeCloseTo(1, 6);
  // tighter cluster → centroid leans more toward the first axis
  expect(tight[0]!).toBeGreaterThan(wide[0]!);
});
