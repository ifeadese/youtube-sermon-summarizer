/**
 * Whether the desktop sidebar is folded to its rail. A per-browser
 * convenience, so localStorage with every access wrapped (same rule as the
 * key store): a throwing storage API must never break the UI.
 */

const KEY = "sermon.history.collapsed";

export function readCollapsed() {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function writeCollapsed(collapsed) {
  try {
    if (collapsed) window.localStorage.setItem(KEY, "1");
    else window.localStorage.removeItem(KEY);
  } catch {
    // ignore — preference just won't stick
  }
}
