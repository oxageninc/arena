/**
 * Parse a URL query string into a plain object.
 */
export function parseQueryString(query) {
  const result = {};
  for (const pair of query.split("&")) {
    const [key, value] = pair.split("=");
    result[key] = value ?? "";
  }
  return result;
}
