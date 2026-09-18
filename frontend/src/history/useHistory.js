/**
 * React hook over the HistoryStore: the only thing in the app that talks to
 * the store. The sidebar and App consume this and never touch storage.
 *
 * Everything here is best-effort: a failing store never throws into the UI.
 * `save` resolves to the entry or null, and `error` carries the last failure
 * (typed, see HistoryStore.js) for the UI to show a toast.
 */

import { useCallback, useContext, useEffect, useRef, useState } from "react";

import { createEntry } from "./entry.js";
import { HistoryStoreContext } from "./historyContext.js";

/** @typedef {"loading" | "ready" | "unavailable"} HistoryStatus */

function isUnavailable(store) {
  return typeof store.isAvailable === "function" && !store.isAvailable();
}

export function useHistory() {
  const store = useContext(HistoryStoreContext);
  if (!store) throw new Error("useHistory must be used inside <HistoryProvider>.");

  const [entries, setEntries] = useState([]);
  const [status, setStatus] = useState(/** @type {HistoryStatus} */ () => (isUnavailable(store) ? "unavailable" : "loading"));
  // The id the user last picked. It may name an entry that has since vanished
  // (deleted in another tab); `active` below is derived, so the UI never sees that.
  const [activeId, setActiveId] = useState(null);
  const [error, setError] = useState(null);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const next = await store.list();
      if (mounted.current) setEntries(next);
      return next;
    } catch (err) {
      if (mounted.current) setError(err);
      return null;
    }
  }, [store]);

  // First load + change notifications from outside this instance (other tabs).
  useEffect(() => {
    mounted.current = true;
    if (!isUnavailable(store)) {
      store.list().then(
        (next) => {
          if (!mounted.current) return;
          setEntries(next);
          setStatus("ready");
        },
        (err) => {
          if (!mounted.current) return;
          setError(err);
          setStatus("ready");
        },
      );
    }
    const unsubscribe = store.subscribe ? store.subscribe(() => refresh()) : () => {};
    return () => {
      mounted.current = false;
      unsubscribe();
    };
  }, [store, refresh]);

  /**
   * Save a finished generation. Resolves to the saved entry (now active) or
   * null if the store refused; never throws.
   */
  const save = useCallback(
    async (input) => {
      if (status === "unavailable") return null;
      let entry;
      try {
        entry = createEntry(input);
      } catch (err) {
        setError(err);
        return null;
      }
      try {
        await store.save(entry);
        setError(null);
        await refresh();
        if (mounted.current) setActiveId(entry.id);
        return entry;
      } catch (err) {
        if (mounted.current) setError(err);
        return null;
      }
    },
    [store, status, refresh],
  );

  /** Mark an entry active. Returns it, or null if it isn't in the list. */
  const select = useCallback(
    (id) => {
      const entry = entries.find((e) => e.id === id) || null;
      setActiveId(entry ? entry.id : null);
      return entry;
    },
    [entries],
  );

  const deselect = useCallback(() => setActiveId(null), []);

  const remove = useCallback(
    async (id) => {
      try {
        await store.remove(id);
        await refresh();
        return true;
      } catch (err) {
        if (mounted.current) setError(err);
        return false;
      }
    },
    [store, refresh],
  );

  const clear = useCallback(async () => {
    try {
      await store.clear();
      await refresh();
      return true;
    } catch (err) {
      if (mounted.current) setError(err);
      return false;
    }
  }, [store, refresh]);

  const clearError = useCallback(() => setError(null), []);

  const active = activeId ? entries.find((e) => e.id === activeId) || null : null;

  return {
    entries,
    status,
    active,
    activeId: active ? active.id : null,
    error,
    save,
    select,
    deselect,
    remove,
    clear,
    clearError,
    refresh,
  };
}
