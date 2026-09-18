/**
 * Shared contract tests every HistoryStore adapter must pass. Import and call
 * from an adapter's own test file: `runHistoryStoreContract(name, factory)`.
 * `factory({ maxEntries })` must return a fresh, empty store.
 */

import { describe, expect, it } from "vitest";

import { createEntry } from "../entry.js";

export function makeEntry(overrides = {}) {
  const { minutesAgo = 0, id, ...rest } = overrides;
  return createEntry({
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    article: `Title ${id || minutesAgo}\n\nBody text here.`,
    provider: "gemini",
    model: "gemini-test",
    now: new Date(Date.UTC(2026, 8, 17, 12, 0) - minutesAgo * 60_000),
    id,
    ...rest,
  });
}

export function runHistoryStoreContract(name, factory) {
  describe(`${name} (HistoryStore contract)`, () => {
    it("starts empty", async () => {
      const store = factory();
      expect(await store.list()).toEqual([]);
      expect(await store.get("nope")).toBeNull();
    });

    it("save returns the entry and list is newest first regardless of insertion order", async () => {
      const store = factory();
      const old = makeEntry({ id: "old", minutesAgo: 60 });
      const mid = makeEntry({ id: "mid", minutesAgo: 30 });
      const fresh = makeEntry({ id: "fresh", minutesAgo: 0 });
      expect(await store.save(mid)).toEqual(mid);
      await store.save(fresh);
      await store.save(old);
      expect((await store.list()).map((e) => e.id)).toEqual(["fresh", "mid", "old"]);
    });

    it("get finds by id", async () => {
      const store = factory();
      const entry = makeEntry({ id: "one" });
      await store.save(entry);
      expect(await store.get("one")).toEqual(entry);
    });

    it("save upserts by id", async () => {
      const store = factory();
      await store.save(makeEntry({ id: "one" }));
      await store.save({ ...makeEntry({ id: "one" }), title: "Renamed" });
      const list = await store.list();
      expect(list).toHaveLength(1);
      expect(list[0].title).toBe("Renamed");
    });

    it("remove deletes one entry and ignores unknown ids", async () => {
      const store = factory();
      await store.save(makeEntry({ id: "a" }));
      await store.save(makeEntry({ id: "b", minutesAgo: 1 }));
      await store.remove("a");
      await store.remove("missing");
      expect((await store.list()).map((e) => e.id)).toEqual(["b"]);
    });

    it("clear empties the store", async () => {
      const store = factory();
      await store.save(makeEntry({ id: "a" }));
      await store.clear();
      expect(await store.list()).toEqual([]);
    });

    it("enforces the cap by dropping the oldest entries", async () => {
      const store = factory({ maxEntries: 3 });
      for (const [id, minutesAgo] of [["d", 40], ["c", 30], ["b", 20], ["a", 10]]) {
        await store.save(makeEntry({ id, minutesAgo }));
      }
      expect((await store.list()).map((e) => e.id)).toEqual(["a", "b", "c"]);
    });

    it("hands back copies, not live references", async () => {
      const store = factory();
      await store.save(makeEntry({ id: "a" }));
      const [first] = await store.list();
      first.title = "mutated";
      expect((await store.get("a")).title).not.toBe("mutated");
    });
  });
}
