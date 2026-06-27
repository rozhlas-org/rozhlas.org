import { test, expect, beforeEach } from "bun:test";

// localStorage shim (bun test has no DOM). progress.ts only touches it inside functions,
// so setting this before any call is enough.
const mem: Record<string, string> = {};
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => (k in mem ? mem[k] : null),
  setItem: (k: string, v: string) => {
    mem[k] = v;
  },
  removeItem: (k: string) => {
    delete mem[k];
  },
};

const { resumeStartIndex, showHasProgress } = await import("../src/scripts/progress.ts");

const NS = "rozhlas:progress:v1";
type Entry = { t: number; done: boolean; at?: number };
function seed(slug: string, entries: Record<string | number, Entry>): void {
  const store: Record<string, Entry> = {};
  for (const [idx, e] of Object.entries(entries)) store[`${slug}#${idx}`] = e;
  mem[NS] = JSON.stringify(store);
}

const parts = (...idxs: (string | number)[]) => idxs.map((idx) => ({ idx }));

beforeEach(() => {
  for (const k of Object.keys(mem)) delete mem[k];
});

test("never played → first part", () => {
  expect(resumeStartIndex("s", parts(1, 2, 3))).toBe(0);
});

test("in-progress part → its index (most recent wins)", () => {
  seed("s", { 1: { t: 0, done: true, at: 100 }, 2: { t: 42, done: false, at: 200 } });
  expect(resumeStartIndex("s", parts(1, 2, 3))).toBe(1); // idx 2 is at position 1
});

test("last-played finished → first not-done part", () => {
  seed("s", { 1: { t: 0, done: true, at: 100 }, 2: { t: 0, done: true, at: 300 } });
  // idx2 most recent + done; idx3 has no entry (not done) → position 2
  expect(resumeStartIndex("s", parts(1, 2, 3))).toBe(2);
});

test("all parts finished → restart at first", () => {
  seed("s", { 1: { t: 0, done: true, at: 100 }, 2: { t: 0, done: true, at: 200 }, 3: { t: 0, done: true, at: 300 } });
  expect(resumeStartIndex("s", parts(1, 2, 3))).toBe(0);
});

test("single-part finished → restart at 0", () => {
  seed("s", { single: { t: 0, done: true, at: 100 } });
  expect(resumeStartIndex("s", parts("single"))).toBe(0);
});

test("single-part in progress → 0 (resumes in place)", () => {
  seed("s", { single: { t: 90, done: false, at: 100 } });
  expect(resumeStartIndex("s", parts("single"))).toBe(0);
});

test("stale/unknown progress keys are ignored", () => {
  seed("s", { 9: { t: 50, done: false, at: 100 } }); // part 9 no longer in the list
  expect(resumeStartIndex("s", parts(1, 2))).toBe(0);
});

test("legacy entries without `at` still resolve (no crash, earliest on tie)", () => {
  seed("s", { 1: { t: 10, done: false }, 2: { t: 20, done: false } });
  expect(resumeStartIndex("s", parts(1, 2))).toBe(0); // both at=0 → earliest in-progress
});

test("non-linear: finished a later part, earlier gap unwatched → first not-done", () => {
  seed("s", { 1: { t: 0, done: true, at: 100 }, 3: { t: 0, done: true, at: 400 } });
  // last-played idx3 done; scan: idx1 done, idx2 no entry → position 1
  expect(resumeStartIndex("s", parts(1, 2, 3))).toBe(1);
});

test("showHasProgress reflects any saved part", () => {
  expect(showHasProgress("s", parts(1, 2))).toBe(false);
  seed("s", { 2: { t: 5, done: false, at: 100 } });
  expect(showHasProgress("s", parts(1, 2))).toBe(true);
});
