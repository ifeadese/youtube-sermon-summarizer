/**
 * localStorage-backed history store — the pilot's interim backend.
 *
 * One key holds `{ version, entries }`. Every storage access is wrapped so a
 * throwing storage API (private mode, strict settings, quota) never breaks
 * the UI: reads degrade to an empty list, writes reject with a typed error
 * the hook can surface. Follows the same conventions as lib/keyStore.js.
 *
 * Cross-tab: the browser fires `storage` in OTHER tabs when this key changes,
 * which is exactly the "changed outside this instance" signal the contract's
 * `subscribe` promises.
 */

import { MAX_ENTRIES, SCHEMA_VERSION, byNewest, isEntry } from "../entry.js";
import { historyError } from "./HistoryStore.js";

export const STORAGE_KEY = "sermon.history";
const PROBE_KEY = `${STORAGE_KEY}.probe`;

function defaultStorage() {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function createLocalStorageStore({ key = STORAGE_KEY, maxEntries = MAX_ENTRIES, storage } = {}) {
  const getStorage = () => (storage === undefined ? defaultStorage() : storage);
  let available = null; // lazily probed once

  function isAvailable() {
    if (available !== null) return available;
    try {
      const s = getStorage();
      if (!s) return (available = false);
      s.setItem(PROBE_KEY, "1");
      const ok = s.getItem(PROBE_KEY) === "1";
      s.removeItem(PROBE_KEY);
      available = ok;
    } catch {
      available = false;
    }
    return available;
  }

  function read() {
    try {
      const raw = getStorage()?.getItem(key);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== SCHEMA_VERSION || !Array.isArray(parsed.entries)) return [];
      return parsed.entries.filter(isEntry).sort(byNewest);
    } catch {
      // Corrupt JSON or a throwing storage API: nothing usable, show nothing.
      return [];
    }
  }

  function writeOnce(entries) {
    getStorage().setItem(key, JSON.stringify({ version: SCHEMA_VERSION, entries }));
  }

  /**
   * Write, evicting the oldest entries one at a time if the browser refuses
   * for lack of space. Gives up (typed "quota") only when even a single entry
   * cannot be stored.
   */
  function write(entries) {
    if (!isAvailable()) throw historyError("unavailable", "History storage is not available in this browser.");
    let remaining = entries;
    for (;;) {
      try {
        writeOnce(remaining);
        return remaining;
      } catch (err) {
        if (remaining.length <= 1) {
          throw historyError("quota", "Couldn't save to history: the browser is out of storage space.", err);
        }
        remaining = remaining.slice(0, -1);
      }
    }
  }

  return {
    async list() {
      return read();
    },
    async get(id) {
      return read().find((e) => e.id === id) || null;
    },
    async save(entry) {
      const next = [entry, ...read().filter((e) => e.id !== entry.id)].sort(byNewest).slice(0, maxEntries);
      write(next);
      return entry;
    },
    async remove(id) {
      const current = read();
      const next = current.filter((e) => e.id !== id);
      if (next.length !== current.length) write(next);
    },
    async clear() {
      try {
        getStorage()?.removeItem(key);
      } catch {
        // nothing to clear, or storage blocked
      }
    },
    subscribe(listener) {
      if (typeof window === "undefined") return () => {};
      const onStorage = (event) => {
        if (event.key === key || event.key === null) listener();
      };
      window.addEventListener("storage", onStorage);
      return () => window.removeEventListener("storage", onStorage);
    },
    isAvailable,
  };
}
