import { test } from "node:test";
import assert from "node:assert/strict";

import { getUser } from "../src/users.mjs";

test("success resolves with ok, status, and parsed data", async () => {
  const user = { id: 7, name: "Ada" };
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => user,
  });
  assert.deepEqual(await getUser(7, fetchImpl), {
    ok: true,
    status: 200,
    data: user,
  });
});

test("HTTP error resolves with ok:false, real status, non-empty error; body not parsed", async () => {
  let jsonCalled = false;
  const fetchImpl = async () => ({
    ok: false,
    status: 404,
    json: async () => {
      jsonCalled = true;
      return {};
    },
  });
  const result = await getUser(999, fetchImpl);
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
  assert.equal(typeof result.error, "string");
  assert.ok(result.error.length > 0);
  assert.equal(jsonCalled, false, "body must not be parsed on HTTP error");
});

test("network failure resolves with ok:false, status 0", async () => {
  const fetchImpl = async () => {
    throw new Error("connection reset");
  };
  const result = await getUser(1, fetchImpl);
  assert.deepEqual(
    { ok: result.ok, status: result.status },
    { ok: false, status: 0 },
  );
  assert.ok(result.error.length > 0);
});

test("JSON parse failure resolves with ok:false, status 0", async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => {
      throw new SyntaxError("Unexpected token < in JSON");
    },
  });
  const result = await getUser(1, fetchImpl);
  assert.equal(result.ok, false);
  assert.equal(result.status, 0);
});

test("never rejects", async () => {
  const fetchImpl = async () => {
    throw new Error("boom");
  };
  await assert.doesNotReject(() => getUser(1, fetchImpl));
});
