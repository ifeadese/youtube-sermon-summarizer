import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearKey, getKey, isRemembered, setKey, subscribeToKeyChanges } from "./keyStore.js";

const STORAGE_KEY = "sermon.gemini.key";

beforeEach(() => {
  clearKey();
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("keyStore", () => {
  it("returns an empty string when nothing is stored", () => {
    expect(getKey()).toBe("");
    expect(isRemembered()).toBe(false);
  });

  it("stores in localStorage when remembered", () => {
    setKey("AIzaTEST", { remember: true });
    expect(getKey()).toBe("AIzaTEST");
    expect(isRemembered()).toBe(true);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("AIzaTEST");
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("stores in sessionStorage when not remembered", () => {
    setKey("AIzaTEST", { remember: false });
    expect(getKey()).toBe("AIzaTEST");
    expect(isRemembered()).toBe(false);
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBe("AIzaTEST");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("defaults to remembering and trims the key", () => {
    setKey("  AIzaTEST  ");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("AIzaTEST");
  });

  it("replacing a remembered key with a session key leaves nothing in localStorage", () => {
    setKey("AIzaOLD", { remember: true });
    setKey("AIzaNEW", { remember: false });
    expect(getKey()).toBe("AIzaNEW");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("clearKey removes the key from every location", () => {
    setKey("AIzaTEST", { remember: true });
    clearKey();
    expect(getKey()).toBe("");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("ignores an empty key", () => {
    setKey("   ");
    expect(getKey()).toBe("");
  });

  it("does not resurrect from memory a key that another tab forgot", () => {
    setKey("AIzaTEST", { remember: true }); // this tab connected it
    window.localStorage.removeItem(STORAGE_KEY); // other tab: Forget key
    expect(getKey()).toBe("");
  });

  it("notifies on storage events for this key (or a clear), and unsubscribes", () => {
    const listener = vi.fn();
    const off = subscribeToKeyChanges(listener);
    window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY, newValue: null }));
    window.dispatchEvent(new StorageEvent("storage", { key: "unrelated", newValue: "x" }));
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
    expect(listener).toHaveBeenCalledTimes(2);
    off();
    window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY, newValue: "y" }));
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("falls back to memory when storage throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    setKey("AIzaMEM", { remember: true });
    expect(getKey()).toBe("AIzaMEM");
    clearKey();
    expect(getKey()).toBe("");
  });
});
