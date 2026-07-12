const BASE_URL = "https://api.example.com";

/**
 * Fetch a user by id. Never rejects: all failures resolve to { ok: false }.
 */
export async function getUser(id, fetchImpl = fetch) {
  try {
    const response = await fetchImpl(`${BASE_URL}/users/${id}`);
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: `Request failed with status ${response.status}`,
      };
    }
    const data = await response.json();
    return { ok: true, status: response.status, data };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
