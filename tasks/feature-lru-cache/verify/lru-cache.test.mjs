import { test } from "node:test";
import assert from "node:assert/strict";

import { createLruCache } from "../src/lru-cache.mjs";

test("stores and retrieves values", () => {
  const cache = createLruCache(2);
  cache.set("a", 1);
  assert.equal(cache.get("a"), 1);
  assert.equal(cache.get("missing"), undefined);
});

test("evicts the least recently used key on overflow", () => {
  const cache = createLruCache(2);
  cache.set("a", 1);
  cache.set("b", 2);
  cache.set("c", 3);
  assert.equal(cache.has("a"), false);
  assert.equal(cache.get("b"), 2);
  assert.equal(cache.get("c"), 3);
});

test("get marks a key most recently used", () => {
  const cache = createLruCache(2);
  cache.set("a", 1);
  cache.set("b", 2);
  cache.get("a"); // now b is LRU
  cache.set("c", 3);
  assert.equal(cache.has("b"), false);
  assert.equal(cache.has("a"), true);
});

test("set on an existing key updates value and recency without eviction", () => {
  const cache = createLruCache(2);
  cache.set("a", 1);
  cache.set("b", 2);
  cache.set("a", 10); // now b is LRU
  cache.set("c", 3);
  assert.equal(cache.get("a"), 10);
  assert.equal(cache.has("b"), false);
  assert.equal(cache.size(), 2);
});

test("has does not affect recency", () => {
  const cache = createLruCache(2);
  cache.set("a", 1);
  cache.set("b", 2);
  cache.has("a"); // must NOT promote a
  cache.set("c", 3);
  assert.equal(cache.has("a"), false, "a stayed LRU and was evicted");
});

test("keys() orders least → most recently used", () => {
  const cache = createLruCache(3);
  cache.set("a", 1);
  cache.set("b", 2);
  cache.set("c", 3);
  cache.get("a");
  assert.deepEqual(cache.keys(), ["b", "c", "a"]);
});

test("stored undefined is distinguishable from absent", () => {
  const cache = createLruCache(2);
  cache.set("u", undefined);
  assert.equal(cache.has("u"), true);
  assert.equal(cache.get("u"), undefined);
});

test("validates maxSize", () => {
  assert.throws(() => createLruCache(0), TypeError);
  assert.throws(() => createLruCache(-1), TypeError);
  assert.throws(() => createLruCache(1.5), TypeError);
  assert.throws(() => createLruCache("3"), TypeError);
});
