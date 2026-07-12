const BASE_URL = "https://api.example.com";

/**
 * Fetch a user by id.
 */
export async function getUser(id, fetchImpl = fetch) {
  const response = await fetchImpl(`${BASE_URL}/users/${id}`);
  const data = await response.json();
  return { ok: true, status: response.status, data };
}
