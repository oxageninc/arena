import { test } from "node:test";
import assert from "node:assert/strict";

import { createRateLimiter } from "../src/rate-limiter.mjs";

function fakeClock(start = 0) {
  let t = start;
  return {
    now: () => t,
    advance: (seconds) => {
      t += seconds;
    },
  };
}

test("bucket starts full", () => {
  const clock = fakeClock();
  const limiter = createRateLimiter({ capacity: 3, refillPerSecond: 1, now: clock.now });
  assert.equal(limiter.tryRemove(3), true);
  assert.equal(limiter.tryRemove(1), false);
});

test("failed tryRemove deducts nothing", () => {
  const clock = fakeClock();
  const limiter = createRateLimiter({ capacity: 2, refillPerSecond: 0, now: clock.now });
  assert.equal(limiter.tryRemove(1), true);
  assert.equal(limiter.tryRemove(2), false);
  assert.equal(limiter.tryRemove(1), true, "the failed attempt must not have consumed the remaining token");
});

test("refills continuously with fractional accrual", () => {
  const clock = fakeClock();
  const limiter = createRateLimiter({ capacity: 2, refillPerSecond: 2, now: clock.now });
  assert.equal(limiter.tryRemove(2), true);
  clock.advance(0.5); // accrues 1 token
  assert.equal(limiter.tryRemove(1), true);
  assert.equal(limiter.tryRemove(1), false);
});

test("never exceeds capacity", () => {
  const clock = fakeClock();
  const limiter = createRateLimiter({ capacity: 2, refillPerSecond: 10, now: clock.now });
  clock.advance(100);
  assert.equal(limiter.tryRemove(2), true);
  assert.equal(limiter.tryRemove(1), false);
});

test("tryRemove defaults to 1", () => {
  const clock = fakeClock();
  const limiter = createRateLimiter({ capacity: 1, refillPerSecond: 0, now: clock.now });
  assert.equal(limiter.tryRemove(), true);
  assert.equal(limiter.tryRemove(), false);
});

test("validates options", () => {
  assert.throws(() => createRateLimiter({ capacity: 0, refillPerSecond: 1 }), RangeError);
  assert.throws(() => createRateLimiter({ capacity: -1, refillPerSecond: 1 }), RangeError);
  assert.throws(() => createRateLimiter({ capacity: Infinity, refillPerSecond: 1 }), RangeError);
  assert.throws(() => createRateLimiter({ capacity: 1, refillPerSecond: -1 }), RangeError);
});
