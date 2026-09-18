import { expect, it, vi } from "vitest";

import { createMemoryStore } from "./memoryStore.js";
import { makeEntry, runHistoryStoreContract } from "./storeContract.js";

runHistoryStoreContract("memoryStore", (opts) => createMemoryStore(opts));

it("seeds from `initial` sorted newest first", async () => {
  const store = createMemoryStore({ initial: [makeEntry({ id: "old", minutesAgo: 5 }), makeEntry({ id: "new" })] });
  expect((await store.list()).map((e) => e.id)).toEqual(["new", "old"]);
});

it("notifies subscribers of external changes and unsubscribes", () => {
  const store = createMemoryStore();
  const listener = vi.fn();
  const off = store.subscribe(listener);
  store._emitExternalChange();
  expect(listener).toHaveBeenCalledTimes(1);
  off();
  store._emitExternalChange();
  expect(listener).toHaveBeenCalledTimes(1);
});
