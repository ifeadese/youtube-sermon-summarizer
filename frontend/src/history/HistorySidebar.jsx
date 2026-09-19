import { memo, useEffect, useId, useMemo, useRef, useState } from "react";
import { CircleOff, Clock, PanelLeftClose, PanelLeftOpen, Plus, Trash2, X } from "lucide-react";

import { MAX_ENTRIES } from "./entry.js";
import { groupByDay, relativeTime, shortVideoRef } from "./format.js";

/**
 * The article history sidebar. Presentation only: it receives the hook's
 * state and callbacks from App and knows nothing about storage. Memoised:
 * App re-renders on every streamed chunk and none of these props change then.
 *
 * Desktop: a column beside the hero, foldable to a narrow rail.
 * Mobile: the same panel as a left drawer (`open`), see App.css.
 *
 * @param {object} props
 * @param {import("./entry.js").HistoryEntry[]} props.entries  newest first
 * @param {"loading"|"ready"|"unavailable"} props.status
 * @param {string|null} props.activeId
 * @param {boolean} props.busy            a generation is running: no select/new/delete
 * @param {string} props.pendingUrl       the URL being generated, for the pending row
 * @param {boolean} props.collapsed       desktop rail state
 * @param {boolean} props.open            mobile drawer state
 * @param {(id: string) => void} props.onSelect
 * @param {() => void} props.onNew
 * @param {(id: string) => void} props.onRemove
 * @param {() => void} props.onClear
 * @param {() => void} props.onToggleCollapsed
 * @param {() => void} props.onClose
 */
function HistorySidebar({
  entries,
  status,
  activeId,
  busy,
  pendingUrl,
  collapsed,
  open,
  onSelect,
  onNew,
  onRemove,
  onClear,
  onToggleCollapsed,
  onClose,
}) {
  const [confirmId, setConfirmId] = useState(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const listRef = useRef(null);
  const newBtnRef = useRef(null);
  const closeBtnRef = useRef(null);
  // The row to hand focus back to when its delete confirm is dismissed.
  const refocusId = useRef(null);
  const headingId = useId();

  // Drawer opened: put focus inside it. Closing returns focus in App.
  useEffect(() => {
    if (open) closeBtnRef.current?.focus();
  }, [open]);

  // An entry that vanished (deleted elsewhere) can't stay in confirm mode.
  const confirmEntry = confirmId ? entries.find((e) => e.id === confirmId) : null;
  const confirming = confirmEntry ? confirmId : null;

  // The confirm's buttons unmount with it; without this, focus falls to <body>.
  useEffect(() => {
    if (confirming || !refocusId.current) return;
    const rows = Array.from(listRef.current?.querySelectorAll(".history__open") || []);
    rows.find((row) => row.dataset.id === refocusId.current)?.focus();
    refocusId.current = null;
  }, [confirming]);

  const count = entries.length;
  const atCap = count >= MAX_ENTRIES;
  const groups = useMemo(() => groupByDay(entries), [entries]);
  const showPending = busy && Boolean(pendingUrl);

  function confirmDelete(id) {
    onRemove(id);
    setConfirmId(null);
    newBtnRef.current?.focus();
  }

  function keepEntry() {
    refocusId.current = confirming;
    setConfirmId(null);
  }

  function clearAll() {
    onClear();
    setConfirmClear(false);
    newBtnRef.current?.focus();
  }

  // Arrow keys move between rows; Delete starts the inline confirm; Escape
  // backs out of a confirm. Rows are plain buttons so Tab still works.
  function handleListKeyDown(event) {
    if (event.key === "Escape" && confirming) {
      event.preventDefault(); // also tells App's drawer listener the key is spent
      keepEntry();
      return;
    }
    const rows = Array.from(listRef.current?.querySelectorAll(".history__open") || []);
    const index = rows.indexOf(document.activeElement);
    if (index === -1) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = event.key === "ArrowDown" ? Math.min(index + 1, rows.length - 1) : Math.max(index - 1, 0);
      rows[next]?.focus();
    } else if ((event.key === "Delete" || event.key === "Backspace") && !busy) {
      event.preventDefault();
      setConfirmId(rows[index].dataset.id);
    }
  }

  let body;
  if (status === "unavailable") {
    body = (
      <div className="history__empty">
        <span className="history__empty-icon" aria-hidden="true">
          <CircleOff size={18} />
        </span>
        <p className="history__empty-title">History is off</p>
        <p className="history__empty-text">Your browser is blocking storage, so articles won&rsquo;t be kept. Generating still works.</p>
      </div>
    );
  } else if (status === "loading") {
    body = (
      <div className="history__skeleton" aria-busy="true">
        <span className="visually-hidden">Loading history</span>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="history__skeleton-row" aria-hidden="true" />
        ))}
      </div>
    );
  } else if (!count && !showPending) {
    body = (
      <div className="history__empty">
        <span className="history__empty-icon" aria-hidden="true">
          <Clock size={18} />
        </span>
        <p className="history__empty-title">Nothing here yet</p>
        <p className="history__empty-text">Articles you generate will appear here. They&rsquo;re saved in this browser only.</p>
      </div>
    );
  } else {
    const pendingRow = showPending && (
      <li className="history__row history__row--pending" aria-label="Writing article">
        <span className="history__row-title">
          Writing article
          <span className="dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        </span>
        <span className="history__row-meta">{shortVideoRef(pendingUrl)}</span>
      </li>
    );
    // The pending row belongs to Today, even when Today has no saved entries yet.
    const rendered = groups.length && groups[0].label === "Today" ? groups : [{ label: "Today", entries: [] }, ...groups];
    body = (
      <div className="history__list" ref={listRef} onKeyDown={handleListKeyDown}>
        {rendered.map((group) => {
          if (!group.entries.length && !(group.label === "Today" && showPending)) return null;
          const labelId = `${headingId}-${group.label.replace(/\s+/g, "-")}`;
          return (
            <section key={group.label} className="history__group" aria-labelledby={labelId}>
              <h3 id={labelId} className="history__group-label">
                {group.label}
              </h3>
              <ul className="history__rows">
                {group.label === "Today" && pendingRow}
                {group.entries.map((entry) =>
                  confirming === entry.id ? (
                    <li key={entry.id} className="history__row history__row--confirm" role="alert">
                      <span className="history__confirm-text">Delete this article?</span>
                      <button type="button" className="history__confirm-btn history__confirm-btn--yes" onClick={() => confirmDelete(entry.id)}>
                        Delete
                      </button>
                      <button type="button" className="history__confirm-btn" onClick={keepEntry} autoFocus>
                        Keep
                      </button>
                    </li>
                  ) : (
                    <li key={entry.id} className={`history__row ${entry.id === activeId ? "history__row--active" : ""}`}>
                      <button
                        type="button"
                        className="history__open"
                        data-id={entry.id}
                        onClick={() => onSelect(entry.id)}
                        aria-current={entry.id === activeId ? "true" : undefined}
                        aria-disabled={busy || undefined}
                        title={entry.title}
                      >
                        <span className="history__row-title">{entry.title}</span>
                        <span className="history__row-meta">
                          {relativeTime(entry.createdAt)} &middot; {entry.wordCount.toLocaleString()} words
                        </span>
                      </button>
                      <button
                        type="button"
                        className="history__delete"
                        onClick={() => setConfirmId(entry.id)}
                        disabled={busy}
                        aria-label={`Delete ${entry.title}`}
                        title="Delete"
                      >
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    </li>
                  ),
                )}
              </ul>
            </section>
          );
        })}
      </div>
    );
  }

  let footer = null;
  if (status === "ready" && count) {
    footer = confirmClear ? (
      <div className="history__clear-confirm" role="alert">
        <span>
          Remove all {count} {count === 1 ? "article" : "articles"} from this browser?
        </span>
        <div className="history__confirm-actions">
          <button type="button" className="history__confirm-btn history__confirm-btn--yes" onClick={clearAll}>
            Clear all
          </button>
          <button type="button" className="history__confirm-btn" onClick={() => setConfirmClear(false)} autoFocus>
            Keep
          </button>
        </div>
      </div>
    ) : (
      <div className="history__foot">
        <span className={`history__count ${atCap ? "history__count--cap" : ""}`}>
          {atCap ? `${count} of ${MAX_ENTRIES}` : `${count} ${count === 1 ? "article" : "articles"}`}
        </span>
        <button type="button" className="history__clear" onClick={() => setConfirmClear(true)} disabled={busy}>
          Clear history
        </button>
      </div>
    );
  }

  return (
    <aside
      id="history"
      className={`history ${collapsed ? "history--collapsed" : ""} ${open ? "history--open" : ""}`}
      aria-label="Article history"
    >
      <div className="history__rail">
        <button type="button" className="history__rail-btn" onClick={onToggleCollapsed} aria-label="Show history" title="Show history">
          <PanelLeftOpen size={16} aria-hidden="true" />
          {count > 0 && <span className="history__badge">{count}</span>}
        </button>
        <button type="button" className="history__rail-btn" onClick={onNew} disabled={busy} aria-label="New article" title="New article">
          <Plus size={16} aria-hidden="true" />
        </button>
      </div>

      <div className="history__panel">
        <div className="history__top">
          <span className="history__title">History</span>
          <button type="button" className="history__icon-btn history__collapse" onClick={onToggleCollapsed} aria-label="Hide history" title="Hide history">
            <PanelLeftClose size={16} aria-hidden="true" />
          </button>
          <button type="button" className="history__icon-btn history__close" onClick={onClose} aria-label="Close history" ref={closeBtnRef}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <button type="button" className="history__new" onClick={onNew} disabled={busy} ref={newBtnRef}>
          <Plus size={15} aria-hidden="true" />
          New article
        </button>
        {body}
        {footer}
      </div>
    </aside>
  );
}

export default memo(HistorySidebar);
