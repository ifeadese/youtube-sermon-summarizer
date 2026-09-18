/**
 * The history entry: one saved article generation.
 *
 * Pure helpers only — no storage, no React. Every adapter stores exactly this
 * shape, and `isEntry` is the single gate an adapter uses to accept a record
 * it reads back (from localStorage today, from a server or an import file
 * later). Bump SCHEMA_VERSION on any breaking change to the shape and teach
 * `isEntry`/the adapter how to migrate the old one; until it can, an adapter
 * leaves another version's data alone rather than writing over it.
 */

import { countWords } from "../lib/text.js";

export const SCHEMA_VERSION = 1;

/** Sidebar cap. The oldest entries beyond this are dropped on save. */
export const MAX_ENTRIES = 50;

const MAX_TITLE_LENGTH = 120;
const FALLBACK_TITLE = "Untitled reflection";

/**
 * @typedef {object} HistoryEntry
 * @property {string} id            Unique, stable id (UUID when available).
 * @property {number} schemaVersion SCHEMA_VERSION at the time of saving.
 * @property {string} url           Canonical YouTube URL that was submitted.
 * @property {string|null} videoId  The 11-char video id, or null if unparseable.
 * @property {string} title         First line of the article (the model emits the title there).
 * @property {string} article       Full article text.
 * @property {number} wordCount
 * @property {string} provider      e.g. "gemini"
 * @property {string} model         e.g. "gemini-3.8-flash"
 * @property {string} createdAt     ISO-8601 timestamp.
 */

/** The article's first non-empty line, trimmed and capped. */
export function titleFromArticle(article) {
  const line = String(article || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find(Boolean);
  if (!line) return FALLBACK_TITLE;
  return line.length > MAX_TITLE_LENGTH ? `${line.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…` : line;
}

/** The `v` param of a canonical watch URL, or null. Never throws. */
export function videoIdFromUrl(url) {
  try {
    return new URL(url).searchParams.get("v") || null;
  } catch {
    return null;
  }
}

function newId() {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch {
    // fall through
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Build a new entry from a finished generation.
 * @param {{ url: string, article: string, provider: string, model: string, now?: Date, id?: string }} input
 * @returns {HistoryEntry}
 */
export function createEntry({ url, article, provider, model, now = new Date(), id = newId() }) {
  const text = String(article || "");
  if (!text.trim()) throw new Error("Cannot save an empty article.");
  return {
    id,
    schemaVersion: SCHEMA_VERSION,
    url: String(url || ""),
    videoId: videoIdFromUrl(url),
    title: titleFromArticle(text),
    article: text,
    wordCount: countWords(text),
    provider: String(provider || ""),
    model: String(model || ""),
    createdAt: now.toISOString(),
  };
}

/**
 * True when `value` is a well-formed entry of the current schema. Adapters
 * drop anything that fails this on read, so a corrupt or foreign record can
 * never reach the UI.
 */
export function isEntry(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof value.id === "string" &&
      value.id &&
      value.schemaVersion === SCHEMA_VERSION &&
      typeof value.url === "string" &&
      (value.videoId === null || typeof value.videoId === "string") &&
      typeof value.title === "string" &&
      typeof value.article === "string" &&
      value.article &&
      typeof value.wordCount === "number" &&
      typeof value.provider === "string" &&
      typeof value.model === "string" &&
      typeof value.createdAt === "string" &&
      !Number.isNaN(Date.parse(value.createdAt)),
  );
}

/** Newest first; ties broken by id so the order is stable. */
export function byNewest(a, b) {
  const diff = Date.parse(b.createdAt) - Date.parse(a.createdAt);
  return diff !== 0 ? diff : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
