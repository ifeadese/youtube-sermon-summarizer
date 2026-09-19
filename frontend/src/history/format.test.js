import { describe, expect, it, vi } from "vitest";

import { groupByDay, relativeTime, shortDate, shortVideoRef } from "./format.js";

const NOW = new Date(2026, 8, 17, 12, 0, 0); // local time, Thu Sep 17 2026 noon
const ago = (ms) => new Date(NOW.getTime() - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("relativeTime", () => {
  it("steps from just now through minutes, hours and days", () => {
    expect(relativeTime(ago(10_000), NOW)).toBe("just now");
    expect(relativeTime(ago(5 * MIN), NOW)).toBe("5m ago");
    expect(relativeTime(ago(2 * HOUR), NOW)).toBe("2h ago");
    expect(relativeTime(ago(3 * DAY), NOW)).toBe("3d ago");
  });
  it("switches to a short date after a week", () => {
    expect(relativeTime(ago(8 * DAY), NOW)).toBe(shortDate(ago(8 * DAY), NOW));
    expect(relativeTime(ago(8 * DAY), NOW)).toMatch(/Sep 9/);
  });
  it("is empty for garbage", () => {
    expect(relativeTime("nope", NOW)).toBe("");
  });
});

describe("shortDate", () => {
  it("omits the year for this year and includes it otherwise", () => {
    expect(shortDate(new Date(2026, 7, 20).toISOString(), NOW)).toBe("Aug 20");
    expect(shortDate(new Date(2025, 7, 20).toISOString(), NOW)).toMatch(/Aug 20, 2025/);
  });
});

describe("groupByDay", () => {
  const e = (id, iso) => ({ id, createdAt: iso });
  it("buckets by calendar day and drops empty groups", () => {
    const groups = groupByDay(
      [
        e("a", ago(HOUR)),
        e("b", new Date(2026, 8, 16, 23, 0).toISOString()),
        e("c", ago(4 * DAY)),
        e("d", ago(30 * DAY)),
      ],
      NOW,
    );
    expect(groups.map((g) => [g.label, g.entries.map((x) => x.id)])).toEqual([
      ["Today", ["a"]],
      ["Yesterday", ["b"]],
      ["Previous 7 days", ["c"]],
      ["Older", ["d"]],
    ]);
  });
  it("treats an early-morning entry today as Today, not hours-based", () => {
    const groups = groupByDay([e("a", new Date(2026, 8, 17, 0, 30).toISOString())], NOW);
    expect(groups[0].label).toBe("Today");
  });
  it("returns nothing for no entries", () => {
    expect(groupByDay([], NOW)).toEqual([]);
  });
  it("keeps yesterday as Yesterday on the 25-hour day after clocks fall back", () => {
    vi.stubEnv("TZ", "America/Toronto"); // DST ended Sun Nov 1 2026, 02:00
    try {
      const now = new Date(2026, 10, 2, 12, 0);
      const groups = groupByDay([e("sun", new Date(2026, 10, 1, 10, 0).toISOString()), e("tue", new Date(2026, 9, 27, 10, 0).toISOString())], now);
      expect(groups.map((g) => [g.label, g.entries.map((x) => x.id)])).toEqual([
        ["Yesterday", ["sun"]],
        ["Previous 7 days", ["tue"]],
      ]);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("shortVideoRef", () => {
  it("prefers the video id", () => {
    expect(shortVideoRef("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("youtu.be/dQw4w9WgXcQ");
  });
  it("falls back to the host, then to empty", () => {
    expect(shortVideoRef("https://www.youtube.com/")).toBe("youtube.com");
    expect(shortVideoRef("nope")).toBe("");
  });
});
