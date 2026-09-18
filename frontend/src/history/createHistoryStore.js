/**
 * The ONE place that decides which history backend the app uses.
 *
 * localStorage is the pilot's interim backend. To move history to a server
 * or a hosted database later: add an adapter under ./store/ that satisfies
 * HistoryStore.js, and return it here. Nothing in the hook or the sidebar
 * needs to change.
 */

import { assertHistoryStore } from "./store/HistoryStore.js";
import { createLocalStorageStore } from "./store/localStorageStore.js";

export function createHistoryStore() {
  return assertHistoryStore(createLocalStorageStore());
}
