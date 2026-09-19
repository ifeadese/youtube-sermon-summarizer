/** Whitespace-separated word count. The one definition: result bar, analytics, history and the client's length check all use it. */
export function countWords(text) {
  const trimmed = String(text || "").trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}
