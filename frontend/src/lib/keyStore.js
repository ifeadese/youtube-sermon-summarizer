/**
 * Where the user's Gemini key lives: this browser, nowhere else.
 *
 * "Remember on this device" → localStorage (survives reloads and restarts).
 * Otherwise → sessionStorage (gone when the tab closes). If storage is blocked
 * (private mode, strict settings) the key is kept in memory for this page load
 * so the app still works. Every storage access is wrapped: a throwing storage
 * API must never break the UI.
 */

const STORAGE_KEY = "sermon.gemini.key";

let memoryKey = "";

function store(kind) {
  try {
    if (typeof window === "undefined") return null;
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

function read(kind) {
  try {
    return store(kind)?.getItem(STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function remove(kind) {
  try {
    store(kind)?.removeItem(STORAGE_KEY);
  } catch {
    // ignore — nothing to clear, or storage blocked
  }
}

/** The stored key, or "" when none. */
export function getKey() {
  return read("local") || read("session") || memoryKey;
}

/** True when the key is remembered across sessions (localStorage). */
export function isRemembered() {
  return Boolean(read("local"));
}

/** Store a key. Replaces any previous key in every location. */
export function setKey(key, { remember = true } = {}) {
  clearKey();
  const value = String(key || "").trim();
  if (!value) return;
  memoryKey = value;
  try {
    store(remember ? "local" : "session")?.setItem(STORAGE_KEY, value);
  } catch {
    // storage blocked — memoryKey still holds it for this page load
  }
}

/** Forget the key everywhere. */
export function clearKey() {
  memoryKey = "";
  remove("local");
  remove("session");
}
