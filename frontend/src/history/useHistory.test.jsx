import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import HistoryProvider from "./HistoryProvider.jsx";
import { createMemoryStore } from "./store/memoryStore.js";
import { makeEntry } from "./store/storeContract.js";
import { useHistory } from "./useHistory.js";

const INPUT = {
  url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  article: "A Title\n\nSome body text.",
  provider: "gemini",
  model: "gemini-test",
};

function setup(store) {
  const wrapper = ({ children }) => <HistoryProvider store={store}>{children}</HistoryProvider>;
  return renderHook(() => useHistory(), { wrapper });
}

describe("useHistory", () => {
  it("throws without a provider", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useHistory())).toThrow(/HistoryProvider/);
  });

  it("loads existing entries and reports ready", async () => {
    const store = createMemoryStore({ initial: [makeEntry({ id: "a" })] });
    const { result } = setup(store);
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.entries.map((e) => e.id)).toEqual(["a"]);
    expect(result.current.active).toBeNull();
  });

  it("save adds the entry to the front and makes it active", async () => {
    const store = createMemoryStore({ initial: [makeEntry({ id: "older", minutesAgo: 5 })] });
    const { result } = setup(store);
    await waitFor(() => expect(result.current.status).toBe("ready"));
    let saved;
    await act(async () => {
      saved = await result.current.save(INPUT);
    });
    expect(saved.title).toBe("A Title");
    expect(result.current.entries.map((e) => e.id)).toEqual([saved.id, "older"]);
    expect(result.current.activeId).toBe(saved.id);
    expect(result.current.active.article).toBe(INPUT.article);
    expect((await store.list())[0]).toEqual(saved);
  });

  it("a save that lands after the user picked another entry does not steal the selection", async () => {
    const store = createMemoryStore({ initial: [makeEntry({ id: "a", minutesAgo: 5 })] });
    const realSave = store.save;
    let release;
    store.save = (entry) => new Promise((resolve) => {
      release = () => resolve(realSave(entry));
    });
    const { result } = setup(store);
    await waitFor(() => expect(result.current.status).toBe("ready"));
    let pending;
    act(() => {
      pending = result.current.save(INPUT);
    });
    act(() => {
      result.current.select("a");
    });
    await act(async () => {
      release();
      await pending;
    });
    expect(result.current.entries).toHaveLength(2);
    expect(result.current.activeId).toBe("a");
  });

  it("select and deselect change the active entry", async () => {
    const store = createMemoryStore({ initial: [makeEntry({ id: "a" }), makeEntry({ id: "b", minutesAgo: 1 })] });
    const { result } = setup(store);
    await waitFor(() => expect(result.current.status).toBe("ready"));
    let picked;
    act(() => {
      picked = result.current.select("b");
    });
    expect(picked.id).toBe("b");
    expect(result.current.active.id).toBe("b");
    act(() => {
      expect(result.current.select("missing")).toBeNull();
    });
    expect(result.current.active).toBeNull();
    act(() => result.current.select("a"));
    act(() => result.current.deselect());
    expect(result.current.activeId).toBeNull();
  });

  it("remove drops the entry and clears it if it was active", async () => {
    const store = createMemoryStore({ initial: [makeEntry({ id: "a" }), makeEntry({ id: "b", minutesAgo: 1 })] });
    const { result } = setup(store);
    await waitFor(() => expect(result.current.status).toBe("ready"));
    act(() => result.current.select("a"));
    await act(async () => {
      await result.current.remove("a");
    });
    expect(result.current.entries.map((e) => e.id)).toEqual(["b"]);
    expect(result.current.activeId).toBeNull();
  });

  it("clear empties everything", async () => {
    const store = createMemoryStore({ initial: [makeEntry({ id: "a" })] });
    const { result } = setup(store);
    await waitFor(() => expect(result.current.status).toBe("ready"));
    act(() => result.current.select("a"));
    await act(async () => {
      await result.current.clear();
    });
    expect(result.current.entries).toEqual([]);
    expect(result.current.activeId).toBeNull();
  });

  it("surfaces a failed save as `error`, resolves null, and leaves the list alone", async () => {
    const store = createMemoryStore();
    store.save = vi.fn().mockRejectedValue(Object.assign(new Error("full"), { type: "quota" }));
    const { result } = setup(store);
    await waitFor(() => expect(result.current.status).toBe("ready"));
    let saved;
    await act(async () => {
      saved = await result.current.save(INPUT);
    });
    expect(saved).toBeNull();
    expect(result.current.error).toMatchObject({ type: "quota", op: "save" });
    expect(result.current.entries).toEqual([]);
    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();
  });

  it("rejects an empty article without touching the store", async () => {
    const store = createMemoryStore();
    const spy = vi.spyOn(store, "save");
    const { result } = setup(store);
    await waitFor(() => expect(result.current.status).toBe("ready"));
    let saved;
    await act(async () => {
      saved = await result.current.save({ ...INPUT, article: "   " });
    });
    expect(saved).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    expect(result.current.error).toBeTruthy();
  });

  it("reports unavailable and skips saves when the store cannot be used", async () => {
    const store = createMemoryStore();
    store.isAvailable = () => false;
    const spy = vi.spyOn(store, "save");
    const { result } = setup(store);
    await waitFor(() => expect(result.current.status).toBe("unavailable"));
    let saved;
    await act(async () => {
      saved = await result.current.save(INPUT);
    });
    expect(saved).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    expect(result.current.error).toBeNull();
  });

  it("re-lists when the store reports an external change, and drops a vanished active entry", async () => {
    const store = createMemoryStore({ initial: [makeEntry({ id: "a" })] });
    const { result } = setup(store);
    await waitFor(() => expect(result.current.status).toBe("ready"));
    act(() => result.current.select("a"));
    await act(async () => {
      store._emitExternalChange([makeEntry({ id: "b" })]);
    });
    await waitFor(() => expect(result.current.entries.map((e) => e.id)).toEqual(["b"]));
    expect(result.current.activeId).toBeNull();
  });

  it("stops listening on unmount", async () => {
    const store = createMemoryStore();
    const { result, unmount } = setup(store);
    await waitFor(() => expect(result.current.status).toBe("ready"));
    const spy = vi.spyOn(store, "list");
    unmount();
    store._emitExternalChange();
    expect(spy).not.toHaveBeenCalled();
  });
});
