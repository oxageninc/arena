/**
 * Pagination helpers. Pages are 1-based.
 */
export function pageCount(totalItems, pageSize) {
  return Math.floor(totalItems / pageSize);
}

export function paginate(items, page, pageSize) {
  const start = (page - 1) * pageSize;
  return items.slice(start, start + pageSize);
}
