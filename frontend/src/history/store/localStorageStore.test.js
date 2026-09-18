import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SCHEMA_VERSION } from "../entry.js";
import { STORAGE_KEY, createLocalStorageStore } from "./localStorageStore.js";
import { makeEntry, runHistoryStoreContract } from "./storeContract.js";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

runHistoryStoreContract("localStorageStore", (opts) => createLocalStorageStore(opts));

/** A Storage-like object whose setItem throws once the payload exceeds `limit` bytes. */
function fakeStorage(limit = Infinity) {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => {
      if (v.length > limit) {
        const err = new Error("QuotaExceededError");
        err.name = "QuotaExceededError";
        throw err;
      }
      data.set(k, v);
    },
    removeItem: (k) => data.delete(k),
    _size: () => data.size,
  };
}

describe("localStorageStore specifics", () => {
  it("persists under a versioned envelope", async () => {
    const store = createLocalStorageStore();
    await store.save(makeEntry({ id: "a" }));
    const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
    expect(raw.version).toBe(SCHEMA_VERSION);
    expect(raw.entries.map((e) => e.id)).toEqual(["a"]);
  });

  it("reads back what another instance wrote (same key)", async () => {
    await createLocalStorageStore().save(makeEntry({ id: "a" }));
    expect((await createLocalStorageStore().list()).map((e) => e.id)).toEqual(["a"]);
  });

  it("treats corrupt JSON as empty rather than throwing", async () => {
    window.localStorage.setItem(STORAGE_KEY, "{not json");
    expect(await createLocalStorageStore().list()).toEqual([]);
  });

  it("ignores an envelope from a different schema version", async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: SCHEMA_VERSION + 1, entries: [makeEntry({ id: "a" })] }));
    expect(await createLocalStorageStore().list()).toEqual([]);
  });

  it("drops malformed entries and keeps valid ones", async () => {
    const good = makeEntry({ id: "good" });
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: SCHEMA_VERSION, entries: [{ id: "bad" }, good, null] }));
    expect((await createLocalStorageStore().list()).map((e) => e.id)).toEqual(["good"]);
  });

  it("isAvailable is false and saves reject with type 'unavailable' when storage is missing", async () => {
    const store = createLocalStorageStore({ storage: null });
    expect(store.isAvailable()).toBe(false);
    expect(await store.list()).toEqual([]);
    await expect(store.save(makeEntry({ id: "a" }))).rejects.toMatchObject({ type: "unavailable" });
  });

  it("isAvailable is false when the probe write throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(createLocalStorageStore().isAvailable()).toBe(false);
  });

  it("evicts the oldest entries when the browser refuses for space, keeping the new one", async () => {
    const one = JSON.stringify(makeEntry({ id: "x" })).length;
    // Room for roughly two entries plus the envelope, not three.
    const storage = fakeStorage(one * 2 + 60);
    const store = createLocalStorageStore({ storage });
    await store.save(makeEntry({ id: "c", minutesAgo: 20 }));
    await store.save(makeEntry({ id: "b", minutesAgo: 10 }));
    await store.save(makeEntry({ id: "a", minutesAgo: 0 }));
    expect((await store.list()).map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("rejects with type 'quota' when even a single entry does not fit", async () => {
    const storage = fakeStorage(10);
    const store = createLocalStorageStore({ storage });
    await expect(store.save(makeEntry({ id: "a" }))).rejects.toMatchObject({ type: "quota" });
  });

  it("notifies on storage events for its key (or a clear-all), and unsubscribes", () => {
    const store = createLocalStorageStore();
    const listener = vi.fn();
    const off = store.subscribe(listener);
    window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY, newValue: "{}" }));
    window.dispatchEvent(new StorageEvent("storage", { key: "sermon.gemini.key", newValue: "x" }));
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
    expect(listener).toHaveBeenCalledTimes(2);
    off();
    window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY, newValue: "{}" }));
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("clear removes the key entirely", async () => {
    const store = createLocalStorageStore();
    await store.save(makeEntry({ id: "a" }));
    await store.clear();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
