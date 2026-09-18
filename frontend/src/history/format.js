/**
 * Pure presentation helpers for the sidebar: relative times, short dates,
 * and day grouping. All take `now` so tests are deterministic.
 */

import { videoIdFromUrl } from "./entry.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "just now", "5m ago", "2h ago", "3d ago"; older than a week → short date. */
export function relativeTime(iso, now = new Date()) {
  const diff = now.getTime() - Date.parse(iso);
  if (Number.isNaN(diff)) return "";
  if (diff < MINUTE) return "just now";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`;
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}d ago`;
  return shortDate(iso, now);
}

/** "Sep 14", or "Sep 14, 2025" when it isn't this year. */
export function shortDate(iso, now = new Date()) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const opts = { month: "short", day: "numeric" };
  if (date.getFullYear() !== now.getFullYear()) opts.year = "numeric";
  return date.toLocaleDateString(undefined, opts);
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Local midnight `days` before the midnight `start`. Calendar maths: a DST day is not 24 h. */
function daysBefore(start, days) {
  const d = new Date(start);
  d.setDate(d.getDate() - days);
  return d.getTime();
}

/**
 * Bucket entries (already newest first) into the sidebar's day groups. Only
 * groups with entries are returned, in display order.
 * @returns {{ label: string, entries: import("./entry.js").HistoryEntry[] }[]}
 */
export function groupByDay(entries, now = new Date()) {
  const today = startOfDay(now);
  const yesterday = daysBefore(today, 1);
  const weekAgo = daysBefore(today, 6);
  const buckets = { Today: [], Yesterday: [], "Previous 7 days": [], Older: [] };
  for (const entry of entries) {
    const day = startOfDay(new Date(entry.createdAt));
    if (Number.isNaN(day)) continue;
    if (day >= today) buckets.Today.push(entry);
    else if (day >= yesterday) buckets.Yesterday.push(entry);
    else if (day >= weekAgo) buckets["Previous 7 days"].push(entry);
    else buckets.Older.push(entry);
  }
  return Object.entries(buckets)
    .filter(([, list]) => list.length)
    .map(([label, list]) => ({ label, entries: list }));
}

/** "youtu.be/<id>" for the pending row, or the host when there's no id. */
export function shortVideoRef(url) {
  const id = videoIdFromUrl(url);
  if (id) return `youtu.be/${id}`;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
