import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  API_BASE,
  MODEL,
  REQUEST_TIMEOUT_MS,
  buildRequestBody,
  classify,
  generateReflection,
  readSse,
  validateKey,
} from "./gemini.js";
import { SYSTEM_PROMPT } from "../prompt.js";

const KEY = "AIzaSyTESTKEY000000000000000000000000000";
const URL_ = "https://www.youtube.com/watch?v=abc123";

/** Build an SSE frame. */
function frame(name, data) {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

function delta(text) {
  return frame("step.delta", { index: 0, delta: { type: "text", text }, event_type: "step.delta" });
}

const completed = (usage = { total_tokens: 10 }) =>
  frame("interaction.completed", { event_type: "interaction.completed", interaction: { usage } });

/** A ReadableStream that emits the given string chunks. */
function streamOf(chunks) {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
}

function sseResponse(chunks, status = 200) {
  return new Response(streamOf(chunks), {
    status,
    headers: { "content-type": "text/event-stream" },
  });
}

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const googleError = (code, message, reason) => ({
  error: {
    code,
    message,
    status: "INVALID_ARGUMENT",
    details: reason ? [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason }] : [],
  },
});

let fetchMock;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("readSse", () => {
  it("parses events split across chunks and tolerates CRLF and comments", async () => {
    const chunks = ["event: step.delta\r\ndata: {\"delta\":{\"type\":\"te", "xt\",\"text\":\"hi\"}}\r\n\r\n: keep-alive\n\nevent: done\ndata: {}\n\n"];
    const out = [];
    for await (const ev of readSse(streamOf(chunks))) out.push(ev);
    expect(out).toEqual([
      { name: "step.delta", data: { delta: { type: "text", text: "hi" } } },
      { name: "done", data: {} },
    ]);
  });

  it("emits a trailing event with no final blank line", async () => {
    const out = [];
    for await (const ev of readSse(streamOf(["event: x\ndata: {\"a\":1}"]))) out.push(ev);
    expect(out).toEqual([{ name: "x", data: { a: 1 } }]);
  });
});

describe("buildRequestBody", () => {
  it("includes the model, system prompt, low-res video part, and stream flag", () => {
    const body = buildRequestBody(URL_);
    expect(body.model).toBe(MODEL);
    expect(body.stream).toBe(true);
    expect(body.system_instruction).toBe(SYSTEM_PROMPT);
    expect(body.input).toContainEqual({ type: "video", uri: URL_, resolution: "low" });
    expect(body.input[0].type).toBe("text");
    expect(body.generation_config.thinking_level).toBe("low");
  });
});

describe("generateReflection", () => {
  it("sends the key in a header (never the URL) to the streaming endpoint", async () => {
    fetchMock.mockResolvedValue(sseResponse([delta("Hello"), completed()]));
    await generateReflection({ url: URL_, key: KEY });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe(`${API_BASE}/v1beta/interactions?alt=sse`);
    expect(calledUrl).not.toContain(KEY);
    expect(init.method).toBe("POST");
    expect(init.headers["x-goog-api-key"]).toBe(KEY);
    expect(JSON.parse(init.body)).toEqual(buildRequestBody(URL_));
  });

  it("assembles deltas in order, calls onDelta per chunk, and trims the result", async () => {
    fetchMock.mockResolvedValue(sseResponse([delta("Grace "), delta("and "), delta("peace.\n"), completed()]));
    const seen = [];
    const text = await generateReflection({ url: URL_, key: KEY, onDelta: (t) => seen.push(t) });
    expect(seen).toEqual(["Grace ", "and ", "peace.\n"]);
    expect(text).toBe("Grace and peace.");
  });

  it("handles a delta split across two network chunks", async () => {
    const one = delta("split-me");
    const cut = Math.floor(one.length / 2);
    fetchMock.mockResolvedValue(sseResponse([one.slice(0, cut), one.slice(cut) + completed()]));
    const text = await generateReflection({ url: URL_, key: KEY });
    expect(text).toBe("split-me");
  });

  it("ignores non-text deltas and unrelated events, and reports usage", async () => {
    const thought = frame("step.delta", { delta: { type: "thought", text: "IGNORED" } });
    const usage = { input_tokens: 300000, output_tokens: 900 };
    fetchMock.mockResolvedValue(
      sseResponse([frame("interaction.created", { id: "i1" }), frame("step.start", {}), thought, delta("Real"), frame("step.stop", {}), completed(usage), frame("done", {})]),
    );
    const onUsage = vi.fn();
    const text = await generateReflection({ url: URL_, key: KEY, onUsage });
    expect(text).toBe("Real");
    expect(onUsage).toHaveBeenCalledWith(usage);
  });

  it("throws `empty` when the stream carries no text", async () => {
    fetchMock.mockResolvedValue(sseResponse([frame("interaction.created", {}), completed()]));
    await expect(generateReflection({ url: URL_, key: KEY })).rejects.toMatchObject({ type: "empty" });
  });

  it("maps 400 API_KEY_INVALID to `invalid_key` with the status attached", async () => {
    fetchMock.mockResolvedValue(jsonResponse(googleError(400, "API key not valid. Please pass a valid API key.", "API_KEY_INVALID"), 400));
    await expect(generateReflection({ url: URL_, key: KEY })).rejects.toMatchObject({ type: "invalid_key", status: 400 });
  });

  it("maps 429 to `quota`", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: { code: 429, message: "Quota exceeded", status: "RESOURCE_EXHAUSTED" } }, 429));
    await expect(generateReflection({ url: URL_, key: KEY })).rejects.toMatchObject({ type: "quota", status: 429 });
  });

  it("maps a 5xx to `server`", async () => {
    fetchMock.mockResolvedValue(new Response("upstream down", { status: 503 }));
    await expect(generateReflection({ url: URL_, key: KEY })).rejects.toMatchObject({ type: "server", status: 503 });
  });

  it("maps an unreadable video 400 to a video error", async () => {
    fetchMock.mockResolvedValue(jsonResponse(googleError(400, "The YouTube video is private or unavailable."), 400));
    await expect(generateReflection({ url: URL_, key: KEY })).rejects.toMatchObject({ type: "private_video" });
  });

  it("maps a mid-stream numeric 429 error event to `quota`", async () => {
    fetchMock.mockResolvedValue(
      sseResponse([delta("partial"), frame("error", { error: { code: 429, message: "Quota exceeded", status: "RESOURCE_EXHAUSTED" } })]),
    );
    await expect(generateReflection({ url: URL_, key: KEY })).rejects.toMatchObject({ type: "quota" });
  });

  // Real in-stream shapes captured in the spike (HTTP 200, then `event: error`).
  it("maps an in-stream permission_denied (unopenable video) to `private_video`", async () => {
    fetchMock.mockResolvedValue(
      sseResponse([frame("interaction.created", {}), frame("error", { error: { message: "The caller does not have permission", code: "permission_denied" }, event_type: "error" })]),
    );
    await expect(generateReflection({ url: URL_, key: KEY })).rejects.toMatchObject({ type: "private_video" });
  });

  it("maps an in-stream not_found (not a YouTube video) to `unsupported_video`", async () => {
    fetchMock.mockResolvedValue(
      sseResponse([frame("error", { error: { message: "Requested entity was not found.", code: "not_found" }, event_type: "error" })]),
    );
    await expect(generateReflection({ url: URL_, key: KEY })).rejects.toMatchObject({ type: "unsupported_video" });
  });

  it("maps an in-stream string rate-limit code to `quota`", async () => {
    fetchMock.mockResolvedValue(
      sseResponse([frame("error", { error: { message: "slow down", code: "rate_limit_exceeded" }, event_type: "error" })]),
    );
    await expect(generateReflection({ url: URL_, key: KEY })).rejects.toMatchObject({ type: "quota" });
  });

  it("maps a network failure to `network`", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(generateReflection({ url: URL_, key: KEY })).rejects.toMatchObject({ type: "network" });
  });

  it("maps a caller abort to `cancelled`", async () => {
    fetchMock.mockImplementation((_url, { signal }) => new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    }));
    const controller = new AbortController();
    const promise = generateReflection({ url: URL_, key: KEY, signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toMatchObject({ type: "cancelled" });
  });

  it("maps the internal timeout to `timeout`", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation((_url, { signal }) => new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    }));
    const promise = generateReflection({ url: URL_, key: KEY });
    const assertion = expect(promise).rejects.toMatchObject({ type: "timeout" });
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    await assertion;
  });
});

describe("validateKey", () => {
  it("lists one model with the key in a header and resolves true", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ models: [{ name: "models/x" }] }, 200));
    await expect(validateKey(KEY)).resolves.toBe(true);
    const [calledUrl, init] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe(`${API_BASE}/v1beta/models?pageSize=1`);
    expect(calledUrl).not.toContain(KEY);
    expect(init.headers["x-goog-api-key"]).toBe(KEY);
  });

  it("rejects with `invalid_key` on 400 API_KEY_INVALID and on 403", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(googleError(400, "API key not valid.", "API_KEY_INVALID"), 400));
    await expect(validateKey(KEY)).rejects.toMatchObject({ type: "invalid_key", status: 400 });
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { code: 403, message: "Forbidden", status: "PERMISSION_DENIED" } }, 403));
    await expect(validateKey(KEY)).rejects.toMatchObject({ type: "invalid_key", status: 403 });
  });

  it("rejects with `network` when fetch fails", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(validateKey(KEY)).rejects.toMatchObject({ type: "network" });
  });
});

describe("classify", () => {
  it("falls back to bad_response for an unknown 4xx and never includes the key", () => {
    const err = classify(418, { error: { message: "teapot" } });
    expect(err.type).toBe("bad_response");
    expect(JSON.stringify(err.body)).not.toContain(KEY);
  });

  it("treats a request-shape error as bad_response, not a video error", () => {
    const err = classify(400, { error: { message: "Unknown parameter 'media_resolution' at 'input[1]'.", code: "invalid_request" } });
    expect(err.type).toBe("bad_response");
  });

  it("reads HTTP-level 403 as a key problem but in-stream 403 as a video problem", () => {
    expect(classify(403, { error: { code: 403, message: "Forbidden", status: "PERMISSION_DENIED" } }).type).toBe("invalid_key");
    expect(classify(403, { error: { code: "permission_denied", message: "no" } }, { inStream: true }).type).toBe("private_video");
  });
});
