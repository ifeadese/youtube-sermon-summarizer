// Backend API base URL — configurable via env, defaults to the local dev server.
// No URL is hardcoded for production; set VITE_API_BASE_URL at build/deploy time.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

/**
 * Call POST /summarize and return the generated article text.
 * Throws an Error with a user-friendly message on any failure.
 */
export async function generateArticle(url) {
  let response;
  try {
    response = await fetch(`${API_BASE_URL}/summarize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
  } catch {
    // Network-level failure (backend down, DNS, CORS preflight blocked, etc.)
    throw new Error("Could not reach the server. Is the backend running?");
  }

  if (!response.ok) {
    // The backend sends {"detail": "..."} for handled errors. 422 (validation)
    // sends an array — guard so we never surface a raw object to the user.
    let detail = null;
    try {
      const data = await response.json();
      if (typeof data.detail === "string") detail = data.detail;
    } catch {
      detail = null;
    }
    throw new Error(detail || `Something went wrong (error ${response.status}).`);
  }

  const data = await response.json();
  return data.article;
}
