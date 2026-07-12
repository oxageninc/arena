/**
 * Parse a URL query string into a plain object.
 */
function decode(part) {
  return decodeURIComponent(part.replace(/\+/g, " "));
}

export function parseQueryString(query) {
  const stripped = query.startsWith("?") ? query.slice(1) : query;
  const result = {};
  for (const pair of stripped.split("&")) {
    if (pair === "") continue;
    const eq = pair.indexOf("=");
    const rawKey = eq === -1 ? pair : pair.slice(0, eq);
    const rawValue = eq === -1 ? "" : pair.slice(eq + 1);
    const key = decode(rawKey);
    const value = decode(rawValue);
    if (Object.prototype.hasOwnProperty.call(result, key)) {
      const existing = result[key];
      if (Array.isArray(existing)) existing.push(value);
      else result[key] = [existing, value];
    } else {
      result[key] = value;
    }
  }
  return result;
}
