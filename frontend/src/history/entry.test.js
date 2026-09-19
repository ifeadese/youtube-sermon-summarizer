import { describe, expect, it } from "vitest";

import { countWords } from "../lib/text.js";
import { MAX_ENTRIES, SCHEMA_VERSION, byNewest, createEntry, isEntry, titleFromArticle, videoIdFromUrl } from "./entry.js";

const ARTICLE = "The Quiet Work of Waiting on God\n\nPsalm 27:13-14\n\nThere is a kind of waiting that feels like nothing is happening.";
const URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

describe("titleFromArticle", () => {
  it("takes the first non-empty line, trimmed", () => {
    expect(titleFromArticle("\n\n   Hope in the Dark  \nbody")).toBe("Hope in the Dark");
  });
  it("falls back when the article is blank", () => {
    expect(titleFromArticle("   \n  ")).toBe("Untitled reflection");
  });
  it("caps very long titles with an ellipsis", () => {
    const title = titleFromArticle("x".repeat(300));
    expect(title.length).toBe(120);
    expect(title.endsWith("…")).toBe(true);
  });
});

describe("videoIdFromUrl", () => {
  it("reads the v param of a canonical watch URL", () => {
    expect(videoIdFromUrl(URL)).toBe("dQw4w9WgXcQ");
  });
  it("is null for anything else and never throws", () => {
    expect(videoIdFromUrl("https://youtube.com/")).toBeNull();
    expect(videoIdFromUrl("not a url")).toBeNull();
    expect(videoIdFromUrl(undefined)).toBeNull();
  });
});

describe("createEntry", () => {
  it("builds a complete, valid entry", () => {
    const now = new Date("2026-09-17T10:00:00Z");
    const entry = createEntry({ url: URL, article: ARTICLE, provider: "gemini", model: "gemini-test", now, id: "abc" });
    expect(entry).toEqual({
      id: "abc",
      schemaVersion: SCHEMA_VERSION,
      url: URL,
      videoId: "dQw4w9WgXcQ",
      title: "The Quiet Work of Waiting on God",
      article: ARTICLE,
      wordCount: countWords(ARTICLE),
      provider: "gemini",
      model: "gemini-test",
      createdAt: "2026-09-17T10:00:00.000Z",
    });
    expect(isEntry(entry)).toBe(true);
  });
  it("generates unique ids by default", () => {
    const a = createEntry({ url: URL, article: ARTICLE, provider: "p", model: "m" });
    const b = createEntry({ url: URL, article: ARTICLE, provider: "p", model: "m" });
    expect(a.id).toBeTruthy();
    expect(a.id).not.toBe(b.id);
  });
  it("refuses an empty article", () => {
    expect(() => createEntry({ url: URL, article: "  ", provider: "p", model: "m" })).toThrow(/empty/i);
  });
});

describe("isEntry", () => {
  const good = createEntry({ url: URL, article: ARTICLE, provider: "p", model: "m" });
  it("rejects malformed or foreign records", () => {
    expect(isEntry(null)).toBe(false);
    expect(isEntry({})).toBe(false);
    expect(isEntry({ ...good, schemaVersion: SCHEMA_VERSION + 1 })).toBe(false);
    expect(isEntry({ ...good, article: "" })).toBe(false);
    expect(isEntry({ ...good, createdAt: "yesterday" })).toBe(false);
    expect(isEntry({ ...good, id: 5 })).toBe(false);
  });
  it("accepts a null videoId", () => {
    expect(isEntry({ ...good, videoId: null })).toBe(true);
  });
});

describe("byNewest", () => {
  it("sorts newest first with a stable tie-break", () => {
    const mk = (id, createdAt) => ({ id, createdAt });
    const sorted = [mk("b", "2026-01-01T00:00:00Z"), mk("a", "2026-01-01T00:00:00Z"), mk("c", "2026-02-01T00:00:00Z")].sort(byNewest);
    expect(sorted.map((e) => e.id)).toEqual(["c", "a", "b"]);
  });
});

it("exposes the sidebar cap", () => {
  expect(MAX_ENTRIES).toBe(50);
});
