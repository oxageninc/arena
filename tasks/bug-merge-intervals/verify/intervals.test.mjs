import { test } from "node:test";
import assert from "node:assert/strict";

import { mergeIntervals } from "../src/intervals.mjs";

test("merges overlapping intervals", () => {
  assert.deepEqual(mergeIntervals([[1, 4], [2, 6]]), [[1, 6]]);
});

test("merges touching intervals", () => {
  assert.deepEqual(mergeIntervals([[1, 3], [3, 5]]), [[1, 5]]);
});

test("keeps disjoint intervals separate, sorted by start", () => {
  assert.deepEqual(mergeIntervals([[5, 6], [1, 2]]), [[1, 2], [5, 6]]);
});

test("collapses contained intervals", () => {
  assert.deepEqual(mergeIntervals([[1, 10], [2, 3]]), [[1, 10]]);
});

test("handles unsorted mixed input", () => {
  assert.deepEqual(
    mergeIntervals([[8, 10], [1, 3], [2, 6], [15, 18], [10, 11]]),
    [[1, 6], [8, 11], [15, 18]],
  );
});

test("does not mutate the input array", () => {
  const input = [[3, 4], [1, 2]];
  const snapshot = JSON.stringify(input);
  mergeIntervals(input);
  assert.equal(JSON.stringify(input), snapshot);
});

test("empty input returns empty array", () => {
  assert.deepEqual(mergeIntervals([]), []);
});
