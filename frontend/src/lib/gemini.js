/**
 * Browser-side Gemini client (bring-your-own-key).
 *
 * The user's API key is passed in per call and sent only to Google's API host,
 * in the `x-goog-api-key` header (never in the URL, so it can't leak via
 * referrers or logs). Nothing here stores or logs the key.
 *
 * Uses the Gemini Interactions API, which accepts a public YouTube URL directly
 * as a video input — so there is no transcript step and no backend. The
 * response is streamed as server-sent events and surfaced through `onDelta`.
 *
 * Hand-written fetch instead of @google/genai: the SDK is a large bundle and
 * we need exactly two calls.
 */

import { SYSTEM_PROMPT, USER_PROMPT } from "../prompt.js";

export const MODEL = "gemini-3.8-flash";
export const MODEL_LABEL = "Gemini Flash";
export const API_BASE = "https://generativelanguage.googleapis.com";
export const AI_STUDIO_KEY_URL = "https://aistudio.google.com/apikey";

// The model ingests the whole video before writing a word. The spike measured
// ~4 minutes end-to-end for a 30-minute sermon on the free tier, so this is a
// safety net, not a UX budget — the UI offers Cancel for impatient users.
export const REQUEST_TIMEOUT_MS = 600_000;

// 750 words is ~1,100 tokens. Headroom covers the model's (low) thinking budget
// if it is counted against the output cap.
const MAX_OUTPUT_TOKENS = 4096;

const USER_MESSAGES = {
  invalid_key: "That key didn't work. Check it in Google AI Studio and try again.",
  quota: "You've hit the free limit on this key for now. Try again later, or add billing in Google AI Studio.",
  private_video: "Gemini couldn't open that video. Check the link — and note that private and unlisted videos can't be read.",
  unsupported_video: "Gemini couldn't read that video. Try another public YouTube link.",
  network: "Could not reach Gemini. Please check your connection and try again.",
  timeout: "This took too long and was cancelled. Please try again.",
  cancelled: "Generation cancelled.",
  server: "Gemini is having trouble right now. Please try again in a minute.",
  bad_response: "Gemini returned an unexpected response. Please try again.",
  empty: "Gemini returned an empty reflection. Please try again.",
};

/**
 * Build an Error carrying a stable `type` (and optional HTTP `status`) so the UI
 * can show a friendly message and report a useful error_type to analytics.
 * `body` is the parsed Google error payload when there was one (never the key).
 */
export function geminiError(type, { cause, status, body, message } = {}) {
  const text = message || USER_MESSAGES[type] || USER_MESSAGES.bad_response;
  const error = cause ? new Error(text, { cause }) : new Error(text);
  error.type = type;
  if (status) error.status = status;
  if (body) error.body = body;
  return error;
}

function headersFor(key) {
  return { "x-goog-api-key": key, "Content-Type": "application/json" };
}

/** Read a non-2xx body (JSON if possible) and map it to a typed error. */
async function errorFromResponse(response) {
  let body;
  try {
    const text = await response.text();
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return classify(response.status, body);
}

/**
 * Map an error payload to one of our error types. Two shapes exist, both seen
 * in the spike (see PR description):
 *
 *  - HTTP-level (non-2xx response): Google's standard envelope with a numeric
 *    `code`, a `status` name, and `details[].reason` (e.g. API_KEY_INVALID).
 *  - In-stream (`event: error` on a 200 response): `{ error: { message, code } }`
 *    with a snake_case string `code` — `permission_denied` for a video the
 *    model can't open (private, unlisted, or nonexistent), `not_found` for a
 *    URL that isn't a YouTube video. By then the key has already been accepted,
 *    so permission errors are about the video, not the key.
 */
export function classify(status, body, { inStream = false } = {}) {
  const err = body?.error || {};
  const reason = Array.isArray(err.details) ? err.details.find((d) => d?.reason)?.reason : undefined;
  const code = typeof err.code === "string" ? err.code.toLowerCase() : "";
  const message = String(err.message || "");
  const opts = { status, body };

  if (
    reason === "API_KEY_INVALID" ||
    code === "unauthenticated" ||
    code === "api_key_invalid" ||
    (!inStream && (status === 401 || status === 403))
  ) {
    return geminiError("invalid_key", opts);
  }
  if (status === 429 || err.status === "RESOURCE_EXHAUSTED" || /resource_exhausted|rate_limit/.test(code)) {
    return geminiError("quota", opts);
  }
  if (inStream && (code === "permission_denied" || status === 403)) {
    return geminiError("private_video", opts);
  }
  if (inStream && code === "not_found") {
    return geminiError("unsupported_video", opts);
  }
  if (/video|youtube/i.test(message)) {
    if (/private|unlisted|unavailable|not available|not accessible|permission|access/i.test(message)) {
      return geminiError("private_video", opts);
    }
    return geminiError("unsupported_video", opts);
  }
  if (status >= 500 || code === "internal" || code === "unavailable") {
    return geminiError("server", opts);
  }
  return geminiError("bad_response", opts);
}

function isAbort(err) {
  return err?.name === "AbortError";
}

/**
 * Check that a key is accepted by the API without spending any tokens: list
 * models (one page). Resolves `true` on success, throws a typed error otherwise.
 */
export async function validateKey(key, { signal } = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE}/v1beta/models?pageSize=1`, {
      method: "GET",
      headers: { "x-goog-api-key": key },
      signal,
    });
  } catch (err) {
    if (isAbort(err)) throw geminiError("cancelled", { cause: err });
    throw geminiError("network", { cause: err });
  }
  if (!response.ok) throw await errorFromResponse(response);
  return true;
}

/** The exact request body sent to the Interactions API. Exported for tests and the spike. */
export function buildRequestBody(url) {
  return {
    model: MODEL,
    // A plain string: the API rejects a parts array here ("Expected string").
    system_instruction: SYSTEM_PROMPT,
    input: [
      { type: "text", text: USER_PROMPT },
      // Low resolution: sermons are audio-heavy, and it is ~3x cheaper per second.
      // (Field name per the API reference; `media_resolution` is rejected.)
      { type: "video", uri: url, resolution: "low" },
    ],
    generation_config: {
      max_output_tokens: MAX_OUTPUT_TOKENS,
      // The prompt is prescriptive; deep reasoning mostly adds latency.
      thinking_level: "low",
    },
    stream: true,
  };
}

/**
 * Generate the reflection for a YouTube URL, streaming text through `onDelta`.
 *
 * @param {object} args
 * @param {string} args.url        Public YouTube URL.
 * @param {string} args.key        The user's Gemini API key.
 * @param {AbortSignal} [args.signal]  Caller cancellation (maps to type "cancelled").
 * @param {(text: string) => void} [args.onDelta]   Called with each text chunk.
 * @param {(usage: object) => void} [args.onUsage]  Called with the final usage block, if any.
 * @returns {Promise<string>} The full reflection text, trimmed.
 */
export async function generateReflection({ url, key, signal, onDelta, onUsage }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const onCallerAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) onCallerAbort();
    else signal.addEventListener("abort", onCallerAbort, { once: true });
  }
  const abortType = () => (signal?.aborted ? "cancelled" : "timeout");

  try {
    let response;
    try {
      response = await fetch(`${API_BASE}/v1beta/interactions?alt=sse`, {
        method: "POST",
        headers: headersFor(key),
        body: JSON.stringify(buildRequestBody(url)),
        signal: controller.signal,
      });
    } catch (err) {
      if (isAbort(err)) throw geminiError(abortType(), { cause: err });
      throw geminiError("network", { cause: err });
    }

    if (!response.ok) throw await errorFromResponse(response);
    if (!response.body) throw geminiError("bad_response");

    let text = "";
    try {
      for await (const event of readSse(response.body)) {
        if (event.name === "step.delta") {
          const delta = event.data?.delta;
          if (delta?.type === "text" && typeof delta.text === "string" && delta.text) {
            text += delta.text;
            onDelta?.(delta.text);
          }
        } else if (event.name === "interaction.completed") {
          const usage = event.data?.usage ?? event.data?.interaction?.usage;
          if (usage && onUsage) onUsage(usage);
        } else if (event.name === "error" || event.data?.error) {
          const code = Number(event.data?.error?.code) || 0;
          throw classify(code, event.data, { inStream: true });
        }
      }
    } catch (err) {
      if (err?.type) throw err;
      if (isAbort(err)) throw geminiError(abortType(), { cause: err });
      throw geminiError("bad_response", { cause: err });
    }

    const trimmed = text.trim();
    if (!trimmed) throw geminiError("empty");
    return trimmed;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onCallerAbort);
  }
}

/**
 * Minimal server-sent-events parser over a byte stream. Yields
 * `{ name, data }` per event, where `data` is the parsed JSON (or the raw
 * string if it isn't JSON). Handles chunks that split lines or events, and
 * both LF and CRLF line endings.
 */
export async function* readSse(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let name = "message";
  let dataLines = [];

  const flush = () => {
    if (dataLines.length === 0) {
      name = "message";
      return null;
    }
    const raw = dataLines.join("\n");
    dataLines = [];
    const eventName = name;
    name = "message";
    let data = raw;
    try {
      data = JSON.parse(raw);
    } catch {
      // keep raw string
    }
    return { name: eventName, data };
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        let line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (line === "") {
          const event = flush();
          if (event) yield event;
        } else if (line.startsWith(":")) {
          // comment / keep-alive
        } else if (line.startsWith("event:")) {
          name = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).replace(/^ /, ""));
        }
      }
      if (done) break;
    }
    // A final line with no trailing newline is still a line.
    if (buffer !== "") {
      const line = buffer.endsWith("\r") ? buffer.slice(0, -1) : buffer;
      buffer = "";
      if (line.startsWith("event:")) name = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
    }
    const last = flush();
    if (last) yield last;
  } finally {
    reader.releaseLock();
  }
}
