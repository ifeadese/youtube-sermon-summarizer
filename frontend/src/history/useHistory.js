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
  // The last failure, tagged with the operation ("list" | "save" | "remove" |
  // "clear") so the UI can react to a failed save differently from the rest.
  const [error, setError] = useState(null);
  const mounted = useRef(true);
  // Bumped whenever the user picks or drops an entry, so a save that lands
  // late (a slow store) can tell the selection moved on and leave it alone.
  const selection = useRef(0);

  const fail = useCallback((op, err) => {
    if (mounted.current) setError(Object.assign(err, { op }));
  }, []);

  const refresh = useCallback(async () => {
    try {
      const next = await store.list();
      if (mounted.current) setEntries(next);
      return next;
    } catch (err) {
      fail("list", err);
      return null;
    }
  }, [store, fail]);

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
          fail("list", err);
          setStatus("ready");
        },
      );
    }
    const unsubscribe = store.subscribe ? store.subscribe(() => refresh()) : () => {};
    return () => {
      mounted.current = false;
      unsubscribe();
    };
  }, [store, refresh, fail]);

  /**
   * Save a finished generation. Resolves to the saved entry (now active,
   * unless the user picked something else meanwhile) or null if the store
   * refused; never throws.
   */
  const save = useCallback(
    async (input) => {
      if (status === "unavailable") return null;
      const selectionAtStart = selection.current;
      let entry;
      try {
        entry = createEntry(input);
      } catch (err) {
        fail("save", err);
        return null;
      }
      try {
        await store.save(entry);
        setError(null);
        await refresh();
        if (mounted.current && selection.current === selectionAtStart) setActiveId(entry.id);
        return entry;
      } catch (err) {
        fail("save", err);
        return null;
      }
    },
    [store, status, refresh, fail],
  );

  /** Mark an entry active. Returns it, or null if it isn't in the list. */
  const select = useCallback(
    (id) => {
      const entry = entries.find((e) => e.id === id) || null;
      selection.current += 1;
      setActiveId(entry ? entry.id : null);
      return entry;
    },
    [entries],
  );

  const deselect = useCallback(() => {
    selection.current += 1;
    setActiveId(null);
  }, []);

  const remove = useCallback(
    async (id) => {
      try {
        await store.remove(id);
        await refresh();
        return true;
      } catch (err) {
        fail("remove", err);
        return false;
      }
    },
    [store, refresh, fail],
  );

  const clear = useCallback(async () => {
    try {
      await store.clear();
      await refresh();
      return true;
    } catch (err) {
      fail("clear", err);
      return false;
    }
  }, [store, refresh, fail]);

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
  };
}
