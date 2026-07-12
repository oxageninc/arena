import { test } from "node:test";
import assert from "node:assert/strict";

import { parseQueryString } from "../src/query-string.mjs";

test("basic pairs", () => {
  assert.deepEqual(parseQueryString("a=1&b=2"), { a: "1", b: "2" });
});

test("leading ? is ignored", () => {
  assert.deepEqual(parseQueryString("?a=1"), { a: "1" });
});

test("percent-decodes keys and values, + is space", () => {
  assert.deepEqual(parseQueryString("q=hello+w%C3%B6rld"), { q: "hello wörld" });
  assert.deepEqual(parseQueryString("my+key=v%20x"), { "my key": "v x" });
});

test("repeated keys become arrays in order", () => {
  assert.deepEqual(parseQueryString("a=1&a=2&b=3"), { a: ["1", "2"], b: "3" });
  assert.deepEqual(parseQueryString("a=1&a=2&a=3"), { a: ["1", "2", "3"] });
});

test("key without = maps to empty string", () => {
  assert.deepEqual(parseQueryString("flag&a=1"), { flag: "", a: "1" });
  assert.deepEqual(parseQueryString("a="), { a: "" });
});

test("splits on first = only", () => {
  assert.deepEqual(parseQueryString("a=b=c"), { a: "b=c" });
});

test("empty segments skipped; empty inputs give {}", () => {
  assert.deepEqual(parseQueryString("a=1&&b=2"), { a: "1", b: "2" });
  assert.deepEqual(parseQueryString(""), {});
  assert.deepEqual(parseQueryString("?"), {});
});
