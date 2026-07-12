/**
 * Token-bucket rate limiter.
 *
 * createRateLimiter({ capacity, refillPerSecond, now }) -> { tryRemove(count) }
 */
export function createRateLimiter({
  capacity,
  refillPerSecond,
  now = () => Date.now() / 1000,
} = {}) {
  if (!Number.isFinite(capacity) || capacity <= 0) {
    throw new RangeError(`capacity must be a positive finite number, got ${capacity}`);
  }
  if (!Number.isFinite(refillPerSecond) || refillPerSecond < 0) {
    throw new RangeError(
      `refillPerSecond must be a non-negative finite number, got ${refillPerSecond}`,
    );
  }

  let tokens = capacity;
  let lastRefill = now();

  function refill() {
    const current = now();
    const elapsed = Math.max(0, current - lastRefill);
    tokens = Math.min(capacity, tokens + elapsed * refillPerSecond);
    lastRefill = current;
  }

  return {
    tryRemove(count = 1) {
      refill();
      if (tokens >= count) {
        tokens -= count;
        return true;
      }
      return false;
    },
  };
}
