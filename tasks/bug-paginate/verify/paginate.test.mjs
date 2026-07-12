import { test } from "node:test";
import assert from "node:assert/strict";

import { pageCount, paginate } from "../src/paginate.mjs";

const items = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];

test("pageCount includes the final partial page", () => {
  assert.equal(pageCount(10, 3), 4);
  assert.equal(pageCount(9, 3), 3);
  assert.equal(pageCount(1, 3), 1);
});

test("pageCount of zero items is zero", () => {
  assert.equal(pageCount(0, 5), 0);
});

test("pageCount rejects non-positive or fractional pageSize", () => {
  assert.throws(() => pageCount(10, 0), RangeError);
  assert.throws(() => pageCount(10, -2), RangeError);
  assert.throws(() => pageCount(10, 2.5), RangeError);
});

test("paginate returns the right slice", () => {
  assert.deepEqual(paginate(items, 1, 3), ["a", "b", "c"]);
  assert.deepEqual(paginate(items, 4, 3), ["j"]);
});

test("paginate returns [] for out-of-range pages", () => {
  assert.deepEqual(paginate(items, 0, 3), []);
  assert.deepEqual(paginate(items, -1, 3), []);
  assert.deepEqual(paginate(items, 5, 3), []);
});

test("paginate rejects invalid pageSize", () => {
  assert.throws(() => paginate(items, 1, 0), RangeError);
});
