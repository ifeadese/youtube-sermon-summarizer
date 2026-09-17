#!/usr/bin/env node
/**
 * Spike: exercise the real Gemini Interactions API through the app's own
 * browser client (src/lib/gemini.js) from Node, so what we verify is the code
 * that ships.
 *
 * Usage:
 *   node scripts/gemini-spike.mjs <youtube-url> [--bad-key] [--validate-only] [--raw]
 *
 * Reads GEMINI_API_KEY from frontend/.env.local (gitignored). The key is never
 * printed. Output is limited to event names, the first 200 characters of text,
 * usage, timing, and (redacted) error payloads.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { generateReflection, validateKey, readSse, buildRequestBody, API_BASE, API_VERSION } from "../src/lib/gemini.js";

const here = dirname(fileURLToPath(import.meta.url));

function loadKey() {
  const path = join(here, "..", ".env.local");
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    console.error("Missing frontend/.env.local — add a line: GEMINI_API_KEY=<your key>");
    process.exit(2);
  }
  const line = text.split(/\r?\n/).find((l) => l.startsWith("GEMINI_API_KEY="));
  const key = line ? line.slice("GEMINI_API_KEY=".length).trim().replace(/^["']|["']$/g, "") : "";
  if (!key) {
    console.error("GEMINI_API_KEY is empty in frontend/.env.local");
    process.exit(2);
  }
  return key;
}

function redact(value, key) {
  const s = JSON.stringify(value, null, 2) ?? String(value);
  return key ? s.split(key).join("<redacted>") : s;
}

function reportError(err, key) {
  console.log(`ERROR type=${err.type ?? "?"} status=${err.status ?? "-"}`);
  console.log(`message: ${err.message}`);
  if (err.body) console.log(`body: ${redact(err.body, key)}`);
  if (err.cause && !err.body) console.log(`cause: ${redact(String(err.cause?.message ?? err.cause), key)}`);
}

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith("--"));
const badKey = args.includes("--bad-key");
const validateOnly = args.includes("--validate-only");
const raw = args.includes("--raw");

const realKey = loadKey();
const key = badKey ? "AIzaSyNOTAREALKEY00000000000000000000000" : realKey;

console.log(`validateKey → ${badKey ? "(bad key)" : "(key from .env.local)"}`);
try {
  const t0 = Date.now();
  await validateKey(key);
  console.log(`  ok in ${Date.now() - t0} ms`);
} catch (err) {
  reportError(err, realKey);
  if (!badKey) process.exit(1);
}
if (validateOnly) process.exit(0);

if (!url) {
  console.error("Pass a YouTube URL as the first argument.");
  process.exit(2);
}

console.log(`\ngenerateReflection → ${url}`);
const t0 = Date.now();

if (raw) {
  // Print every event name as it arrives, to check the wire format.
  const response = await fetch(`${API_BASE}/${API_VERSION}/interactions?alt=sse`, {
    method: "POST",
    headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify(buildRequestBody(url)),
  });
  console.log(`  HTTP ${response.status} ${response.headers.get("content-type")}`);
  if (!response.ok) {
    console.log(redact(await response.text(), realKey));
    process.exit(1);
  }
  const counts = {};
  let text = "";
  for await (const ev of readSse(response.body)) {
    counts[ev.name] = (counts[ev.name] || 0) + 1;
    if (ev.name === "step.delta" && ev.data?.delta?.type === "text") text += ev.data.delta.text;
    else if (ev.name !== "step.delta") console.log(`  ${ev.name}: ${redact(ev.data, realKey).slice(0, 400)}`);
  }
  console.log(`  events: ${JSON.stringify(counts)}`);
  console.log(`  text (${text.length} chars): ${text.slice(0, 200).replace(/\n/g, " ⏎ ")}`);
  console.log(`  elapsed ${Math.round((Date.now() - t0) / 1000)} s`);
  process.exit(0);
}

let firstDeltaAt = 0;
let deltas = 0;
try {
  const text = await generateReflection({
    url,
    key,
    onDelta: () => {
      deltas += 1;
      if (!firstDeltaAt) firstDeltaAt = Date.now();
    },
    onUsage: (usage) => {
      const video = usage?.input_tokens_by_modality?.find((m) => m.modality === "video")?.tokens ?? 0;
      console.log(`  usage: video=${video} input=${usage?.total_input_tokens} output=${usage?.total_output_tokens} thought=${usage?.total_thought_tokens}`);
    },
    onRetry: (err) => console.log(`  retrying once after: type=${err.type} status=${err.status ?? "-"}`),
  });
  const words = text.trim().split(/\s+/).length;
  console.log(`  ok: ${deltas} deltas, ${text.length} chars, ${words} words`);
  console.log(`  first delta after ${Math.round((firstDeltaAt - t0) / 1000)} s, total ${Math.round((Date.now() - t0) / 1000)} s`);
  console.log(`  head: ${text.slice(0, 200).replace(/\n/g, " ⏎ ")}`);
} catch (err) {
  reportError(err, realKey);
  console.log(`  failed after ${Math.round((Date.now() - t0) / 1000)} s`);
  process.exit(1);
}
