/**
 * LRU cache factory.
 *
 * createLruCache(maxSize) -> { get, set, has, size, keys }
 */
export function createLruCache(maxSize) {
  if (!Number.isInteger(maxSize) || maxSize < 1) {
    throw new TypeError(`maxSize must be a positive integer, got ${maxSize}`);
  }

  // Map iteration order is insertion order; re-inserting moves a key to the
  // end, so the first key is always the least recently used.
  const store = new Map();

  function touch(key) {
    const value = store.get(key);
    store.delete(key);
    store.set(key, value);
  }

  return {
    get(key) {
      if (!store.has(key)) return undefined;
      touch(key);
      return store.get(key);
    },
    set(key, value) {
      if (store.has(key)) store.delete(key);
      else if (store.size >= maxSize) {
        store.delete(store.keys().next().value);
      }
      store.set(key, value);
    },
    has(key) {
      return store.has(key);
    },
    size() {
      return store.size;
    },
    keys() {
      return [...store.keys()];
    },
  };
}
