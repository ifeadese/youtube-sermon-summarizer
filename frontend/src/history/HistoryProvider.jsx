import { useState } from "react";

import { createHistoryStore } from "./createHistoryStore.js";
import { HistoryStoreContext } from "./historyContext.js";
import { assertHistoryStore } from "./store/HistoryStore.js";

/**
 * Makes a HistoryStore available to `useHistory()`. Pass `store` to inject
 * one (tests use the memory store); otherwise the app's default is built once.
 */
export default function HistoryProvider({ store, children }) {
  const [value] = useState(() => assertHistoryStore(store || createHistoryStore()));
  return <HistoryStoreContext.Provider value={value}>{children}</HistoryStoreContext.Provider>;
}
