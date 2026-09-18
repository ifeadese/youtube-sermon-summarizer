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
 * The guiding rule: never hand back confident-looking text that isn't a
 * finished reflection of the actual video. A result is returned only when the
 * interaction ended `completed`, the usage shows video was actually read, and
 * the text is a plausible reflection. Everything else is a typed error.
 *
 * Hand-written fetch instead of @google/genai: the SDK is a large bundle and
 * we need exactly two calls.
 */

import { NO_SERMON_SENTINEL, SYSTEM_PROMPT, USER_PROMPT } from "../prompt.js";

export const MODEL = "gemini-3.8-flash";
export const MODEL_LABEL = "Gemini Flash";
export const API_BASE = "https://generativelanguage.googleapis.com";
// Stay on v1beta: a GA `/v1/interactions` route exists but rejects video input
// outright (verified live 2026-09-18: "'video' is not supported for 'type'").
export const API_VERSION = "v1beta";
export const AI_STUDIO_KEY_URL = "https://aistudio.google.com/apikey";
export const GEMINI_TERMS_URL = "https://ai.google.dev/gemini-api/terms";

// Safety net for the whole request. The model ingests the entire video before
// writing a word (measured: 25–245 s of silence), so this is not a UX budget —
// the UI offers Cancel.
export const REQUEST_TIMEOUT_MS = 600_000;
// Once text starts it arrives within a second or two; a long gap after that
// means the stream has stalled. Only armed after the first text delta, because
// silence before it is normal (`interaction.status_update` fires once, so it
// cannot serve as a heartbeat).
export const IDLE_TIMEOUT_MS = 60_000;
export const VALIDATE_TIMEOUT_MS = 15_000;

// Thought tokens count against this cap even at `thinking_level: low` (measured:
// 3,928 thought + 164 output tokens hit a 4,096 cap). 750 words is ~1,100 tokens.
const MAX_OUTPUT_TOKENS = 8192;

// The prompt asks for 550–700 words. Anything under this is a refusal, a
// truncation, or text written from something other than the sermon.
export const MIN_WORDS = 200;

// One retry, only before any text has been delivered, only for failures that
// are transient on Google's side. Never for quota/rate limits.
const RETRY_DELAY_RANGE_MS = [2000, 4000];

const USER_MESSAGES = {
  invalid_key: "That key didn't work. Check it in Google AI Studio and try again.",
  access_denied:
    "Google refused this request for your key's project. Your key is still saved. Check the project in Google AI Studio, then try again.",
  key_restricted:
    "This key is restricted and can't be used from this site. In Google Cloud, remove the key's website or API restrictions, or create a new key in Google AI Studio.",
  api_disabled:
    "Google has the Gemini API turned off for this key's project. Open the project in Google AI Studio to enable it, or create a new key.",
  region:
    "Google's free Gemini tier isn't available for this key's region or project. Enabling billing in Google AI Studio usually fixes it.",
  quota:
    "You've hit the free tier's limit on this key. If it still fails after a minute, that's today's allowance: try again tomorrow, or add billing in Google AI Studio.",
  rate_limited:
    "Gemini is rate-limiting this key right now. Wait a minute and try again. Very long videos can exceed the free tier's per-minute limit.",
  private_video:
    "Gemini couldn't open that video. Check the link — and note that private, unlisted, and age-restricted videos can't be read.",
  unsupported_video: "That doesn't look like a YouTube video link. Paste the link to a single public video.",
  video_not_read:
    "Gemini couldn't read the video itself, so nothing reliable could be written. Check that the link is a public YouTube video and try again.",
  no_sermon: "Gemini didn't find a sermon or teaching in that video. Try the link to the message itself.",
  blocked: "Gemini declined to write about this video.",
  truncated: "Gemini ran out of room before finishing the reflection. Please try again.",
  too_short: "Gemini returned something too short to be a reflection. Please try again.",
  interrupted: "The connection dropped before Gemini finished. Please try again.",
  model_unavailable: "This Gemini model is no longer available. The site needs an update — please let us know.",
  network: "Could not reach Gemini. Please check your connection and try again.",
  timeout: "This took too long, so we stopped waiting. Please try again.",
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
export function geminiError(type, { cause, status, body, definitive } = {}) {
  const text = USER_MESSAGES[type] || USER_MESSAGES.bad_response;
  const error = cause ? new Error(text, { cause }) : new Error(text);
  error.type = type;
  if (status) error.status = status;
  if (body) error.body = body;
  // Set only when Google has said, in so many words, that this key is dead.
  // The UI forgets a stored key on nothing less.
  if (definitive) error.definitive = true;
  return error;
}

// ── Input hygiene ───────────────────────────────────────────────────────────

const VIDEO_ID = /^[\w-]{11}$/;

/**
 * Reduce any common YouTube link to `https://www.youtube.com/watch?v=<id>`, or
 * return null when it isn't a link to a single video.
 *
 * This matters more than it looks: given `…&t=30s`, `…&list=…`, `/live/<id>` or
 * a music.youtube.com link, Gemini does NOT read the video — it fetches the
 * watch page's HTML as text and writes a plausible reflection from the title
 * and description (measured: no video tokens, ~560k text tokens).
 */
export function canonicalizeYouTubeUrl(input) {
  let raw = String(input ?? "").trim();
  if (!raw) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) raw = `https://${raw}`;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  const host = parsed.hostname.toLowerCase().replace(/^(www|m|music)\./, "");
  const parts = parsed.pathname.split("/").filter(Boolean);
  let id = null;
  if (host === "youtu.be") {
    id = parts[0];
  } else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (parts[0] === "watch") id = parsed.searchParams.get("v");
    else if (["live", "shorts", "embed", "v"].includes(parts[0])) id = parts[1];
  }
  return id && VIDEO_ID.test(id) ? `https://www.youtube.com/watch?v=${id}` : null;
}

/**
 * What people actually paste: the key, the key in quotes, or a whole `.env`
 * line (`GEMINI_API_KEY=AIza…`, `export GOOGLE_API_KEY="AIza…"`). Reduce all of
 * them to the bare key. Never rejects: Google has more than one key format.
 */
export function cleanPastedKey(input) {
  let value = String(input ?? "").trim();
  value = value.replace(/^(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=\s*/, "");
  value = value.replace(/^(["'`])(.*)\1$/, "$2");
  return value.trim();
}

/**
 * Clean a pasted key and reject one that can't travel in an HTTP header. A
 * zero-width space from a rich-text paste makes `fetch` throw a TypeError,
 * which would otherwise surface as "check your connection".
 */
function normalizeKey(key) {
  const value = cleanPastedKey(key);
  if (!value || !/^[\x21-\x7e]+$/.test(value)) throw geminiError("invalid_key");
  return value;
}

// ── Error classification ────────────────────────────────────────────────────

// The only signals that mean "this key is dead": everything else leaves a
// stored key alone. Google adds PERMISSION_DENIED reasons over time, and wiping
// a working remembered key on one we don't recognise is not recoverable.
const DEAD_KEY_REASONS = new Set(["API_KEY_INVALID", "API_KEY_EXPIRED"]);

// Google's API-key layer: standard envelope with `details[].reason`.
const REASON_TYPES = {
  API_KEY_INVALID: "invalid_key",
  API_KEY_EXPIRED: "invalid_key",
  API_KEY_HTTP_REFERRER_BLOCKED: "key_restricted",
  API_KEY_IP_ADDRESS_BLOCKED: "key_restricted",
  API_KEY_ANDROID_APP_BLOCKED: "key_restricted",
  API_KEY_IOS_APP_BLOCKED: "key_restricted",
  API_KEY_SERVICE_BLOCKED: "key_restricted",
  SERVICE_DISABLED: "api_disabled",
  CONSUMER_SUSPENDED: "api_disabled",
  BILLING_DISABLED: "api_disabled",
  RATE_LIMIT_EXCEEDED: "rate_limited",
};

// The Interactions layer: snake_case string codes, documented at
// https://ai.google.dev/gemini-api/docs/api-errors. By the time one of these
// arrives the key has been accepted, so `permission_denied` is about the video.
const CODE_TYPES = {
  authentication: "invalid_key",
  permission_denied: "private_video",
  not_found: "unsupported_video",
  model_not_found: "model_unavailable",
  failed_precondition: "region",
  quota_exceeded: "quota",
  rate_limit_exceeded: "rate_limited",
  too_many_requests: "rate_limited",
  api_error: "server",
  service_unavailable: "server",
  deadline_exceeded: "server",
  unimplemented: "server",
  aborted: "server",
  cancelled: "server",
  safety: "blocked",
  recitation: "blocked",
  language: "blocked",
  prohibited_content: "blocked",
  spii: "blocked",
  blocklist: "blocked",
  content_blocked: "blocked",
};

/**
 * Map an error payload to one of our error types. Keyed on documented codes
 * and reasons only — no matching on message text, which is prose Google can
 * reword at any time. Order: key-layer reason, Interactions code, RPC status
 * name, then bare HTTP status.
 */
export function classify(status, body) {
  const err = body?.error || {};
  const opts = { status, body };

  const reason = Array.isArray(err.details) ? err.details.find((d) => d?.reason)?.reason : undefined;
  if (reason && REASON_TYPES[reason]) {
    return geminiError(REASON_TYPES[reason], { ...opts, definitive: DEAD_KEY_REASONS.has(reason) });
  }

  const code = typeof err.code === "string" ? err.code.toLowerCase() : "";
  // Google's daily and per-minute limits can both arrive as `quota_exceeded`;
  // the metric name in the message is the only thing that tells them apart.
  // This is the one place message text is consulted, and only to pick between
  // two 429 messages: when in doubt it stays `quota`, whose wording covers both.
  if (code === "quota_exceeded" && /minute|token/i.test(String(err.message || ""))) return geminiError("rate_limited", opts);
  // `authentication` is documented as "The API key is missing, invalid, or expired."
  if (code && CODE_TYPES[code]) return geminiError(CODE_TYPES[code], { ...opts, definitive: code === "authentication" });

  if (err.status === "FAILED_PRECONDITION") return geminiError("region", opts);
  if (err.status === "RESOURCE_EXHAUSTED" || status === 429) return geminiError("quota", opts);
  // A 401/403 we can't explain (no known reason, no Interactions code) is a
  // refusal, not proof the key is bad. Say so, and leave the key alone.
  if (!code && (status === 401 || status === 403)) return geminiError("access_denied", opts);
  if (status >= 500) return geminiError("server", opts);
  return geminiError("bad_response", opts);
}

/**
 * Parse a non-2xx body. On `?alt=sse` Google frames even pre-stream errors as
 * SSE (`event: error\ndata: {…}`) with content-type text/event-stream, while
 * the API-key layer answers in plain JSON — so try both.
 */
export function parseErrorBody(text) {
  const payload = /^data: ?(.*)$/m.exec(text ?? "")?.[1] ?? text;
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

async function errorFromResponse(response) {
  let text = "";
  try {
    text = await response.text();
  } catch {
    // body unreadable — classify on status alone
  }
  return classify(response.status, parseErrorBody(text));
}

function isAbort(err) {
  return err?.name === "AbortError";
}

/**
 * An AbortController that fires on the caller's signal or after `ms`, whichever
 * comes first. `reason()` says which; `dispose()` clears everything and aborts,
 * which releases the connection (harmless once a response is fully consumed).
 */
function deadline(signal, ms) {
  if (signal?.aborted) throw geminiError("cancelled");
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, ms);
  signal?.addEventListener("abort", abort, { once: true });
  return {
    controller,
    reason: () => (signal?.aborted ? "cancelled" : "timeout"),
    dispose() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      controller.abort();
    },
  };
}

/** GET the model resource: a zero-token call that checks the key and the model together. */
function fetchModel(key, signal) {
  return fetch(`${API_BASE}/${API_VERSION}/models/${MODEL}`, { method: "GET", headers: { "x-goog-api-key": key }, signal });
}

// ── validateKey ─────────────────────────────────────────────────────────────

/**
 * Check that a key is accepted — and that the model this site uses still
 * exists — without spending any tokens or daily requests. Resolves `true`, or
 * throws a typed error. Has its own timeout: the dialog that calls this cannot
 * be closed mid-test.
 */
export async function validateKey(key, { signal } = {}) {
  const value = normalizeKey(key);
  const limit = deadline(signal, VALIDATE_TIMEOUT_MS);
  try {
    let response;
    try {
      response = await fetchModel(value, limit.controller.signal);
    } catch (err) {
      throw geminiError(isAbort(err) ? limit.reason() : "network", { cause: err });
    }
    // WIRE: a missing model is 404 NOT_FOUND here; the key is checked first, so a bad key never gets this far.
    if (response.status === 404) throw geminiError("model_unavailable", { status: 404 });
    if (!response.ok) throw await errorFromResponse(response);
    return true;
  } finally {
    limit.dispose();
  }
}

// ── generateReflection ──────────────────────────────────────────────────────

/** The exact request body sent to the Interactions API. Throws `unsupported_video` for a non-video link. */
export function buildRequestBody(url) {
  const uri = canonicalizeYouTubeUrl(url);
  if (!uri) throw geminiError("unsupported_video");
  return {
    model: MODEL,
    // A plain string: the API rejects a parts array here ("Expected string").
    system_instruction: SYSTEM_PROMPT,
    input: [
      { type: "text", text: USER_PROMPT },
      // Low resolution: sermons are audio-heavy, and it is ~3x cheaper per second.
      // (Field name per the API reference; `media_resolution` is rejected.)
      { type: "video", uri, resolution: "low" },
    ],
    generation_config: {
      max_output_tokens: MAX_OUTPUT_TOKENS,
      // The prompt is prescriptive; deep reasoning mostly adds latency.
      thinking_level: "low",
    },
    // Interactions are stored server-side by default (1 day free / 55 days
    // paid) and retrievable by id, system prompt included. We use neither
    // `previous_interaction_id` nor background mode, so opt out. Side effect:
    // errors then arrive as HTTP statuses with SSE-framed bodies, and response
    // headers arrive only once generation starts.
    store: false,
    stream: true,
  };
}

function countWords(text) {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/** Decide whether a finished stream is a real reflection. Returns the text or throws. */
function acceptResult(text, terminal) {
  if (!terminal) throw geminiError("interrupted");

  const status = terminal.status;
  if (status !== "completed") {
    if (status === "incomplete") throw geminiError("truncated");
    if (terminal.error) throw classify(0, { error: terminal.error });
    throw geminiError("server");
  }

  // If Google reports a per-modality breakdown and there is no video in it, the
  // model never saw the video (it read a web page as text instead).
  const modalities = terminal.usage?.input_tokens_by_modality;
  if (Array.isArray(modalities) && !modalities.some((m) => m?.modality === "video" && m.tokens > 0)) {
    throw geminiError("video_not_read");
  }

  const trimmed = text.trim();
  if (!trimmed) throw geminiError("empty");
  if (trimmed.includes(NO_SERMON_SENTINEL)) throw geminiError("no_sermon");
  if (countWords(trimmed) < MIN_WORDS) throw geminiError("too_short");
  return trimmed;
}

/** One attempt. `state.delivered` flips true once any text reached the caller. */
async function attempt({ uri, key, signal, onDelta, onUsage }, state) {
  const limit = deadline(signal, REQUEST_TIMEOUT_MS);
  const { controller } = limit;
  let idleTimer = null;
  const armIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => controller.abort(), IDLE_TIMEOUT_MS);
  };
  let consumerError = null;

  try {
    let response;
    try {
      response = await fetch(`${API_BASE}/${API_VERSION}/interactions?alt=sse`, {
        method: "POST",
        headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
        body: JSON.stringify(buildRequestBody(uri)),
        signal: controller.signal,
      });
    } catch (err) {
      throw geminiError(isAbort(err) ? limit.reason() : "network", { cause: err });
    }

    if (!response.ok) throw await errorFromResponse(response);
    if (!response.body) throw geminiError("bad_response");

    let text = "";
    let terminal = null;
    try {
      for await (const event of readSse(response.body)) {
        if (idleTimer) armIdle();
        if (event.name === "step.delta") {
          const delta = event.data?.delta;
          if (delta?.type === "text" && typeof delta.text === "string" && delta.text) {
            text += delta.text;
            armIdle();
            if (onDelta) {
              state.delivered = true;
              try {
                onDelta(delta.text);
              } catch (err) {
                consumerError = err;
                throw err;
              }
            }
          }
        } else if (event.name === "interaction.completed") {
          terminal = event.data?.interaction ?? event.data ?? {};
        } else if (event.name === "error" || event.data?.error) {
          throw classify(Number(event.data?.error?.code) || 0, event.data);
        }
      }
    } catch (err) {
      // A bug in the caller's own onDelta is not Gemini's fault: pass it through.
      if (consumerError && err === consumerError) throw err;
      if (err?.type) throw err;
      // Anything else thrown while reading is the connection failing mid-stream
      // (a phone locking, a network change): readSse never throws on bad data.
      throw geminiError(isAbort(err) ? limit.reason() : "interrupted", { cause: err });
    }

    const result = acceptResult(text, terminal);
    if (terminal?.usage && onUsage) onUsage(terminal.usage);
    return result;
  } finally {
    clearTimeout(idleTimer);
    // Always close the connection: after a thrown in-stream error or a consumer
    // exception the request would otherwise keep running against the user's
    // quota until the server gave up.
    limit.dispose();
  }
}

const RETRYABLE = new Set(["network", "server"]);

/**
 * WIRE: a retired or unknown model answers the generate call with HTTP 404 and
 * code `not_found` — the same code as "that URL isn't a video" (the documented
 * `model_not_found` is not what arrives). Links are canonicalized before they
 * are sent, so ask the one question that tells the two apart.
 */
async function modelIsMissing(key, signal) {
  let limit;
  try {
    limit = deadline(signal, VALIDATE_TIMEOUT_MS);
    return (await fetchModel(key, limit.controller.signal)).status === 404;
  } catch {
    return false; // can't tell — keep the original error
  } finally {
    limit?.dispose();
  }
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(geminiError("cancelled"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(geminiError("cancelled"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Generate the reflection for a YouTube URL, streaming text through `onDelta`.
 *
 * @param {object} args
 * @param {string} args.url        Any common YouTube video link; canonicalized here.
 * @param {string} args.key        The user's Gemini API key.
 * @param {AbortSignal} [args.signal]  Caller cancellation (maps to type "cancelled").
 * @param {(text: string) => void} [args.onDelta]   Called with each text chunk.
 * @param {(usage: object) => void} [args.onUsage]  Called with the final usage block.
 * @param {(error: Error) => void} [args.onRetry]   Called before the single automatic retry.
 * @param {number} [args.retries=1]       Automatic retries for transient failures before any text.
 * @returns {Promise<string>} The full reflection text, trimmed.
 */
export async function generateReflection({ url, key, signal, onDelta, onUsage, onRetry, retries = 1 }) {
  const uri = canonicalizeYouTubeUrl(url);
  if (!uri) throw geminiError("unsupported_video");
  const value = normalizeKey(key);

  for (let tries = 0; ; tries += 1) {
    const state = { delivered: false };
    try {
      return await attempt({ uri, key: value, signal, onDelta, onUsage }, state);
    } catch (err) {
      if (err?.body?.error?.code === "not_found" && (await modelIsMissing(value, signal))) {
        throw geminiError("model_unavailable", { status: err.status, body: err.body });
      }
      const canRetry = tries < retries && RETRYABLE.has(err?.type) && !state.delivered && !signal?.aborted;
      if (!canRetry) throw err;
      onRetry?.(err);
      const [min, max] = RETRY_DELAY_RANGE_MS;
      await sleep(min + Math.random() * (max - min), signal);
    }
  }
}

// ── SSE ─────────────────────────────────────────────────────────────────────

/**
 * Minimal server-sent-events parser over a byte stream. Yields
 * `{ name, data }` per event, where `data` is the parsed JSON (or the raw
 * string if it isn't JSON, e.g. the literal `[DONE]`). Handles chunks that
 * split lines, events or multi-byte characters, and both LF and CRLF endings.
 * (TextDecoder strips a leading BOM; bare-CR endings are legal SSE but Google
 * never sends them, so they are not handled.)
 *
 * On exit — normal, thrown, or early `return()` — the underlying stream is
 * cancelled, not merely unlocked, so the HTTP connection is released.
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

  const takeLine = (line) => {
    if (line.startsWith("event:")) name = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
    // comments (":"), `id:` and `retry:` are ignored
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
        } else {
          takeLine(line);
        }
      }
      if (done) break;
    }
    // A final line with no trailing newline is still a line.
    if (buffer !== "") {
      takeLine(buffer.endsWith("\r") ? buffer.slice(0, -1) : buffer);
      buffer = "";
    }
    const last = flush();
    if (last) yield last;
  } finally {
    try {
      await reader.cancel();
    } catch {
      // already closed or errored
    }
    reader.releaseLock();
  }
}
