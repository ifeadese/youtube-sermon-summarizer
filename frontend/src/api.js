// Backend API base URL — configurable via env, defaults to the local dev server.
// No URL is hardcoded for production; set VITE_API_BASE_URL at build/deploy time.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

// The backend targets <90s for a typical sermon; allow headroom for free-tier
// cold starts before giving up rather than spinning forever.
const REQUEST_TIMEOUT_MS = 120_000;

/**
 * Call POST /summarize and return the generated article text.
 * Throws an Error with a user-friendly message on any failure (network,
 * timeout, backend error, or a malformed success payload).
 */
export async function generateArticle(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(`${API_BASE_URL}/summarize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new Error("This took too long and was cancelled. Please try again.", { cause: err });
    }
    // Network-level failure (backend down, DNS, CORS preflight blocked, etc.)
    throw new Error(
      "Could not reach the server. Please check your connection and try again.",
      { cause: err },
    );
  } finally {
    clearTimeout(timer);
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

  // Validate the success payload — a 200 with a non-JSON body (e.g. a proxy
  // HTML page) or a non-string `article` must not leak a parser error or crash
  // the render. Surface a friendly fallback instead.
  let data;
  try {
    data = await response.json();
  } catch (err) {
    throw new Error("The server returned an unexpected response. Please try again.", {
      cause: err,
    });
  }

  const article = typeof data?.article === "string" ? data.article.trim() : "";
  if (!article) {
    throw new Error("The server returned an empty article. Please try again.");
  }
  return article;
}
