/**
 * Sanitize form data before submission.
 * Strips HTML tags, trims whitespace, and caps strings at 1000 characters.
 * Ported from onehub/lib/sanitize.ts.
 */
export function sanitizeFormData(data) {
  const sanitized = {};

  for (const [key, value] of Object.entries(data)) {
    if (typeof value === "string") {
      sanitized[key] = value.replace(/<[^>]*>/g, "").trim().slice(0, 1000);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}
