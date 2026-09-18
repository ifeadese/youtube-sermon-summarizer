/**
 * The storage contract every history adapter implements.
 *
 * The hook and the sidebar talk to this interface and nothing else, so
 * swapping localStorage for a database later means writing one new adapter
 * and changing one line in createHistoryStore.js. Rules that keep the swap
 * cheap:
 *
 *  - Every method is async and returns a Promise, even when the backing store
 *    is synchronous. A server adapter then needs no changes upstream.
 *  - `list()` resolves newest first (see `byNewest` in entry.js). Callers
 *    never sort.
 *  - `save()` upserts by id and enforces the adapter's cap by dropping the
 *    oldest entries. It rejects with an Error whose `type` is "quota" when the
 *    entry cannot be stored even after eviction, and "unavailable" when the
 *    backing store cannot be used at all.
 *  - `subscribe()` is optional. When present it calls the listener after the
 *    data changed *outside* this store instance (another tab, another
 *    device); the caller re-lists. It returns an unsubscribe function.
 *  - `isAvailable()` is optional and synchronous. `false` means the UI should
 *    show history as off; saves will reject with type "unavailable".
 *
 * @typedef {object} HistoryStore
 * @property {() => Promise<import("../entry.js").HistoryEntry[]>} list
 * @property {(id: string) => Promise<import("../entry.js").HistoryEntry|null>} get
 * @property {(entry: import("../entry.js").HistoryEntry) => Promise<import("../entry.js").HistoryEntry>} save
 * @property {(id: string) => Promise<void>} remove
 * @property {() => Promise<void>} clear
 * @property {(listener: () => void) => () => void} [subscribe]
 * @property {() => boolean} [isAvailable]
 */

const REQUIRED = ["list", "get", "save", "remove", "clear"];

/** Build an Error carrying a stable `type` for the hook to branch on. */
export function historyError(type, message, cause) {
  const error = cause ? new Error(message, { cause }) : new Error(message);
  error.type = type;
  return error;
}

/** Throw early if `store` is missing any required method. */
export function assertHistoryStore(store) {
  for (const method of REQUIRED) {
    if (typeof store?.[method] !== "function") {
      throw new TypeError(`History store is missing the "${method}" method.`);
    }
  }
  return store;
}
