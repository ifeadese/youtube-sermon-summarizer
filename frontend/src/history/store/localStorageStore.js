/**
 * localStorage-backed history store — the pilot's interim backend.
 *
 * One key holds `{ version, entries }`. Every storage access is wrapped so a
 * throwing storage API (private mode, strict settings, quota) never breaks
 * the UI: reads degrade to an empty list, writes reject with a typed error
 * the hook can surface. Follows the same conventions as lib/keyStore.js.
 *
 * An envelope written by a different SCHEMA_VERSION (a newer deploy in another
 * tab) reads as empty but is never overwritten: writes reject with type
 * "incompatible" until this tab reloads or the adapter learns to migrate it.
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

/** Browsers disagree on the name; the legacy codes cover old Safari and Firefox. */
function isQuotaError(err) {
  return err?.name === "QuotaExceededError" || err?.name === "NS_ERROR_DOM_QUOTA_REACHED" || err?.code === 22 || err?.code === 1014;
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
    } catch (err) {
      // A full origin still reads and deletes fine, so history stays on and the
      // save reports "quota". Full while empty means a zero quota: blocked.
      available = isQuotaError(err) && getStorage().length > 0;
    }
    return available;
  }

  /**
   * The stored entries, plus `foreign` when the key holds another schema
   * version's envelope: that reads as empty and must not be written over.
   */
  function read() {
    try {
      const raw = getStorage()?.getItem(key);
      if (!raw) return { entries: [], foreign: false };
      const parsed = JSON.parse(raw);
      if (typeof parsed?.version === "number" && parsed.version !== SCHEMA_VERSION) return { entries: [], foreign: true };
      if (!Array.isArray(parsed?.entries)) return { entries: [], foreign: false };
      return { entries: parsed.entries.filter(isEntry).sort(byNewest), foreign: false };
    } catch {
      // Corrupt JSON or a throwing storage API: nothing usable, show nothing.
      return { entries: [], foreign: false };
    }
  }

  /**
   * Write, evicting the oldest entries one at a time if the browser refuses
   * for lack of space. Gives up (typed "quota") only when even a single entry
   * cannot be stored. Entries are serialised once; each retry only re-joins.
   */
  function write(entries) {
    if (!isAvailable()) throw historyError("unavailable", "History storage is not available in this browser.");
    const parts = entries.map((e) => JSON.stringify(e));
    for (let keep = parts.length; ; keep -= 1) {
      try {
        getStorage().setItem(key, `{"version":${SCHEMA_VERSION},"entries":[${parts.slice(0, keep).join(",")}]}`);
        return;
      } catch (err) {
        if (!isQuotaError(err)) throw historyError("unavailable", "Couldn't save to history: the browser refused the write.", err);
        if (keep <= 1) throw historyError("quota", "Couldn't save to history: the browser is out of storage space.", err);
      }
    }
  }

  /** `read()` for a writer: rejects rather than let the caller replace a foreign envelope. */
  function readForWrite() {
    const { entries, foreign } = read();
    if (foreign) throw historyError("incompatible", "History was written by a newer version of this page. Reload to keep saving.");
    return entries;
  }

  return {
    async list() {
      return read().entries;
    },
    async save(entry) {
      const next = [entry, ...readForWrite().filter((e) => e.id !== entry.id)].sort(byNewest).slice(0, maxEntries);
      write(next);
      return entry;
    },
    async remove(id) {
      const current = read().entries;
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
