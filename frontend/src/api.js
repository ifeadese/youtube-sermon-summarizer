// Backend API base URL — configurable via env, defaults to the local dev server.
// No URL is hardcoded for production; set VITE_API_BASE_URL at build/deploy time.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

// The backend targets <90s for a typical sermon; allow headroom for free-tier
// cold starts before giving up rather than spinning forever.
const REQUEST_TIMEOUT_MS = 120_000;

// Build an Error carrying a stable `type` (and optional HTTP `status`) so the UI
// can report a useful error_type to analytics without matching on message text.
function apiError(message, type, { cause, status } = {}) {
  const error = cause ? new Error(message, { cause }) : new Error(message);
  error.type = type;
  if (status) error.status = status;
  return error;
}

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
      throw apiError("This took too long and was cancelled. Please try again.", "timeout", { cause: err });
    }
    // Network-level failure (backend down, DNS, CORS preflight blocked, etc.)
    throw apiError(
      "Could not reach the server. Please check your connection and try again.",
      "network",
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
    // Split client (4xx) vs server (5xx) so the error_type alone is meaningful
    // in dashboards; the exact code rides along in `status`.
    const type = response.status >= 500 ? "http_server" : "http_client";
    throw apiError(
      detail || `Something went wrong (error ${response.status}).`,
      type,
      { status: response.status },
    );
  }

  // Validate the success payload — a 200 with a non-JSON body (e.g. a proxy
  // HTML page) or a non-string `article` must not leak a parser error or crash
  // the render. Surface a friendly fallback instead.
  let data;
  try {
    data = await response.json();
  } catch (err) {
    throw apiError("The server returned an unexpected response. Please try again.", "bad_response", {
      cause: err,
    });
  }

  const article = typeof data?.article === "string" ? data.article.trim() : "";
  if (!article) {
    throw apiError("The server returned an empty article. Please try again.", "empty_article");
  }
  return article;
}
