/**
 * Pagination helpers. Pages are 1-based.
 */
function assertPageSize(pageSize) {
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new RangeError(`pageSize must be a positive integer, got ${pageSize}`);
  }
}

export function pageCount(totalItems, pageSize) {
  assertPageSize(pageSize);
  return Math.ceil(totalItems / pageSize);
}

export function paginate(items, page, pageSize) {
  assertPageSize(pageSize);
  if (page < 1 || page > pageCount(items.length, pageSize)) return [];
  const start = (page - 1) * pageSize;
  return items.slice(start, start + pageSize);
}
