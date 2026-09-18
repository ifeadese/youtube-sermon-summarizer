/**
 * In-memory history store. Used by the test suite and as a reference
 * implementation of the contract in HistoryStore.js. Nothing persists past
 * the page load.
 */

import { MAX_ENTRIES, byNewest } from "../entry.js";

export function createMemoryStore({ maxEntries = MAX_ENTRIES, initial = [] } = {}) {
  let entries = [...initial].sort(byNewest);
  const listeners = new Set();

  return {
    async list() {
      return entries.map((e) => ({ ...e }));
    },
    async get(id) {
      const found = entries.find((e) => e.id === id);
      return found ? { ...found } : null;
    },
    async save(entry) {
      entries = [{ ...entry }, ...entries.filter((e) => e.id !== entry.id)].sort(byNewest).slice(0, maxEntries);
      return { ...entry };
    },
    async remove(id) {
      entries = entries.filter((e) => e.id !== id);
    },
    async clear() {
      entries = [];
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    isAvailable() {
      return true;
    },
    /** Test helper: simulate a change made elsewhere (another tab). */
    _emitExternalChange(next) {
      if (next) entries = [...next].sort(byNewest);
      listeners.forEach((l) => l());
    },
  };
}
