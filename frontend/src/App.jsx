import { useEffect, useMemo, useRef, useState } from "react";
import { Routes, Route, Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { Copy, Check, AlertCircle, Lock, History, RotateCcw, X } from "lucide-react";

import { canonicalizeYouTubeUrl, generateReflection, MODEL } from "./lib/gemini.js";
import { clearKey, getKey, setKey, subscribeToKeyChanges } from "./lib/keyStore.js";
import { initAnalytics, trackEvent, trackPageView } from "./analytics.js";
import { useHistory } from "./history/useHistory.js";
import { readCollapsed, writeCollapsed } from "./history/collapsedPref.js";
import { shortDate } from "./history/format.js";
import HistorySidebar from "./history/HistorySidebar.jsx";
import ConnectGeminiModal from "./ConnectGeminiModal.jsx";
import ProviderChip from "./ProviderChip.jsx";
import About from "./About.jsx";
import Contact from "./Contact.jsx";
import "./App.css";

const BRAND = "Sermon Summarizer";
const PROVIDER = "gemini";

function extractDomain(urlString) {
  try {
    const parsed = new URL(urlString);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

function countWords(text) {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function formatElapsed(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

const CLOSED_MODAL = { open: false, mode: "connect", error: "" };

export default function App() {
  const [url, setUrl] = useState("");
  const [article, setArticle] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [hasKey, setHasKey] = useState(() => Boolean(getKey()));
  const [modal, setModal] = useState(CLOSED_MODAL);
  // One persistent polite live region: screen readers announce changes to it,
  // but not text that is already there when it mounts.
  const [announcement, setAnnouncement] = useState("");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [retrying, setRetrying] = useState(false);
  // Sidebar chrome. `openedFromHistory` tells the result bar whether what's on
  // screen came from the list (chip + Regenerate) or was just generated (Saved).
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [openedFromHistory, setOpenedFromHistory] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [unseenNew, setUnseenNew] = useState(false);

  const inFlight = useRef(false);
  const copyTimer = useRef(null);
  const abortRef = useRef(null);
  // A URL submitted before a key existed; generated as soon as the key connects.
  const pendingUrl = useRef("");
  const startedAtRef = useRef(0);
  const resultRef = useRef(null);
  const scrolledToResult = useRef(false);
  const urlInputRef = useRef(null);
  const historyPillRef = useRef(null);

  const location = useLocation();
  const navigate = useNavigate();
  // Every finished article is kept (in this browser, for now) and listed in
  // the sidebar. Saving is best-effort: a failing store never blocks the result.
  const articleHistory = useHistory();
  const historyError = articleHistory.error;
  const { active: activeEntry, clearError: clearHistoryError } = articleHistory;
  const saveFailed = historyError?.op === "save";

  useEffect(() => {
    initAnalytics();
  }, []);

  useEffect(() => {
    trackPageView(location.pathname);
  }, [location.pathname]);

  useEffect(
    () => () => {
      clearTimeout(copyTimer.current);
      abortRef.current?.abort();
    },
    [],
  );

  // Another tab connected or forgot the key: keep the chip honest.
  useEffect(() => subscribeToKeyChanges(() => setHasKey(Boolean(getKey()))), []);

  // A store failure is invisible otherwise (the article is still on screen).
  // Report it so a quota or blocked-storage problem shows up in the dashboard.
  useEffect(() => {
    if (historyError) trackEvent("history_error", { op: historyError.op || "unknown", error_type: historyError.type || "unknown" });
  }, [historyError]);

  // The save-failed toast and the "Saved" chip both time out on their own.
  useEffect(() => {
    if (!saveFailed) return undefined;
    const id = setTimeout(clearHistoryError, 8000);
    return () => clearTimeout(id);
  }, [saveFailed, clearHistoryError]);

  useEffect(() => {
    if (!savedFlash) return undefined;
    const id = setTimeout(() => setSavedFlash(false), 4000);
    return () => clearTimeout(id);
  }, [savedFlash]);

  // Mobile drawer: Escape closes it.
  useEffect(() => {
    if (!drawerOpen) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") closeDrawer();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Elapsed time while Gemini reads the video (the silent phase is 25 s to
  // several minutes). Visible only; the live region is not updated every second.
  useEffect(() => {
    if (!loading) return undefined;
    const id = setInterval(() => setElapsedMs(Date.now() - startedAtRef.current), 1000);
    return () => clearInterval(id);
  }, [loading]);

  // Bring the reading pane into view when the first text arrives. No
  // follow-the-stream scrolling: real streams finish within a second or two,
  // and pinning to the bottom would leave the reader at the end of the article.
  useEffect(() => {
    if (loading && article && !scrolledToResult.current) {
      scrolledToResult.current = true;
      resultRef.current?.scrollIntoView?.({ block: "start", behavior: "smooth" });
    }
    if (!loading) scrolledToResult.current = false;
  }, [loading, article]);

  const stats = useMemo(() => {
    const words = countWords(article);
    return { words, minutes: Math.max(1, Math.round(words / 200)) };
  }, [article]);

  function openModal(mode, initialError = "") {
    setModal({ open: true, mode, error: initialError });
  }

  function closeModal() {
    pendingUrl.current = "";
    setModal(CLOSED_MODAL);
  }

  function handleSubmit(event) {
    event.preventDefault();
    startGeneration(url);
  }

  /** Validate a pasted link, then generate — or ask for a key first. */
  function startGeneration(rawUrl) {
    if (inFlight.current) return;

    // One definition of "a YouTube video link", shared with the client: a
    // playlist or channel page is refused here, before the key dialog opens,
    // and music./scheme-less/timestamped links are accepted and normalised.
    const videoUrl = canonicalizeYouTubeUrl(rawUrl);
    if (!videoUrl) {
      trackEvent("invalid_url_attempt", { domain: extractDomain(String(rawUrl).trim()) });
      setError("Please enter a valid YouTube URL.");
      return;
    }

    const key = getKey();
    if (!key) {
      pendingUrl.current = videoUrl;
      setError("");
      openModal("connect");
      return;
    }
    runGeneration(videoUrl, key);
  }

  async function runGeneration(targetUrl, key) {
    if (inFlight.current) return;
    inFlight.current = true;
    startedAtRef.current = Date.now();
    setElapsedMs(0);
    setRetrying(false);
    setLoading(true);
    setError("");
    setArticle("");
    setCopied(false);
    // A new run is a new entry; the one open from the sidebar is no longer what's on screen.
    articleHistory.deselect();
    setOpenedFromHistory(false);
    setSavedFlash(false);
    setAnnouncement("Generating. Gemini is watching the sermon and writing the reflection.");

    // The video id is the one thing about the video we record, and the page
    // says so. Never the article, never the key. `targetUrl` is canonical.
    const meta = { video_id: new URL(targetUrl).searchParams.get("v"), provider: PROVIDER, model: MODEL };
    trackEvent("generate_submit", meta);

    const controller = new AbortController();
    abortRef.current = controller;
    const startedAt = Date.now();
    let firstTextAt = 0;

    try {
      const result = await generateReflection({
        url: targetUrl,
        key,
        signal: controller.signal,
        onDelta: (chunk) => {
          if (!firstTextAt) firstTextAt = Date.now();
          setArticle((current) => current + chunk);
        },
        onRetry: () => {
          setRetrying(true);
          trackEvent("generate_retry", meta);
        },
      });
      setArticle(result);
      setAnnouncement(`Reflection ready, ${countWords(result)} words.`);
      trackEvent("generate_success", {
        ...meta,
        latency_ms: Date.now() - startedAt,
        first_text_ms: firstTextAt ? firstTextAt - startedAt : 0,
        word_count: countWords(result),
      });
      // After the success event: a refused save must not look like a failed
      // generation. Resolves null on failure and reports via `error` (see above).
      const saved = await articleHistory.save({ url: targetUrl, article: result, provider: PROVIDER, model: MODEL });
      if (saved) {
        setSavedFlash(true);
        setUnseenNew(true);
      }
    } catch (err) {
      setArticle("");
      setAnnouncement(err?.type === "cancelled" ? "Generation cancelled." : "");
      if (err?.type === "cancelled") {
        trackEvent("generate_cancel", { ...meta, latency_ms: Date.now() - startedAt });
      } else if (err?.type === "invalid_key" && err.definitive) {
        // Google said in so many words that the stored key is dead (revoked or
        // expired): forget it and ask again, keeping the URL so the retry is
        // one click. Nothing less than that definitive signal clears a key.
        clearKey();
        setHasKey(false);
        pendingUrl.current = targetUrl;
        openModal("connect", err.message);
        trackEvent("generate_error", { ...meta, error_type: "invalid_key", status: err?.status || 0 });
      } else if (err?.type === "invalid_key") {
        // Rejected, but not provably dead: keep the key, show the message in
        // the manage dialog so the user can replace it if they want to.
        pendingUrl.current = targetUrl;
        openModal("manage", err.message);
        trackEvent("generate_error", { ...meta, error_type: "invalid_key", status: err?.status || 0 });
      } else {
        setError(err?.message || "Something went wrong. Please try again.");
        trackEvent("generate_error", { ...meta, error_type: err?.type || "unknown", status: err?.status || 0 });
      }
    } finally {
      abortRef.current = null;
      setLoading(false);
      inFlight.current = false;
    }
  }

  function handleCancel() {
    abortRef.current?.abort();
  }

  // ── Sidebar ──────────────────────────────────────────────────────────────

  function toggleCollapsed() {
    setCollapsed((current) => {
      writeCollapsed(!current);
      return !current;
    });
  }

  function openDrawer() {
    setUnseenNew(false);
    setDrawerOpen(true);
  }

  function closeDrawer() {
    setDrawerOpen(false);
    historyPillRef.current?.focus();
  }

  /** Show a saved article again: fill the input, render the text, mark it active. */
  function handleSelectEntry(id) {
    if (loading) return;
    const entry = articleHistory.select(id);
    if (!entry) return;
    setUrl(entry.url);
    setArticle(entry.article);
    setError("");
    setCopied(false);
    setSavedFlash(false);
    setOpenedFromHistory(true);
    setDrawerOpen(false);
    trackEvent("history_select", { video_id: entry.videoId });
  }

  /** Back to the empty form, ready for the next paste. */
  function handleNewArticle() {
    if (loading) return;
    articleHistory.deselect();
    setUrl("");
    setArticle("");
    setError("");
    setCopied(false);
    setOpenedFromHistory(false);
    setDrawerOpen(false);
    urlInputRef.current?.focus();
  }

  async function handleRemoveEntry(id) {
    const wasOnScreen = openedFromHistory && articleHistory.activeId === id;
    trackEvent("history_delete", {});
    await articleHistory.remove(id);
    if (wasOnScreen && !inFlight.current) {
      setUrl("");
      setArticle("");
      setOpenedFromHistory(false);
    }
  }

  async function handleClearHistory() {
    trackEvent("history_clear", { count: articleHistory.entries.length });
    await articleHistory.clear();
    if (openedFromHistory && !inFlight.current) {
      setUrl("");
      setArticle("");
      setOpenedFromHistory(false);
    }
  }

  function handleConnected(key, { remember }) {
    setKey(key, { remember });
    setHasKey(true);
    const next = pendingUrl.current;
    pendingUrl.current = "";
    setModal(CLOSED_MODAL);
    if (next) {
      // The dialog can outlive a route change (browser Back while it is open);
      // the result only renders on the home page.
      if (location.pathname !== "/") navigate("/");
      runGeneration(next, key);
    }
  }

  function handleForget() {
    clearKey();
    setHasKey(false);
    closeModal();
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(article);
      setError(""); // clear any stale copy error from a previous failed attempt
      setCopied(true);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
      trackEvent("copy_article", { success: true });
    } catch {
      setError("Couldn't copy to the clipboard — please select and copy the text manually.");
      trackEvent("copy_article", { success: false });
    }
  }

  return (
    <div className="page">
      <header className="topbar">
        <Link
          className="brand"
          to="/"
          aria-label={`${BRAND} home`}
          onClick={() => trackEvent("nav_click", { target: "home" })}
        >
          <span className="brand__mark" aria-hidden="true">
            ✦
          </span>
          {BRAND}
        </Link>
        <div className="topbar__right">
          {location.pathname === "/" && (
            <button
              type="button"
              className="chip history-pill"
              onClick={openDrawer}
              aria-controls="history"
              aria-expanded={drawerOpen}
              ref={historyPillRef}
            >
              <History size={14} aria-hidden="true" />
              <span className="chip__label">History</span>
              {unseenNew ? (
                <span className="history-pill__dot" aria-label="New article saved" />
              ) : (
                articleHistory.entries.length > 0 && <span className="history-pill__count">{articleHistory.entries.length}</span>
              )}
            </button>
          )}
          <ProviderChip connected={hasKey} onClick={() => openModal(hasKey ? "manage" : "connect")} />
          <nav className="nav" aria-label="Primary">
            <NavLink
              to="/about"
              className={({ isActive }) => `nav-btn ${isActive ? "nav-btn--active" : ""}`}
              onClick={() => trackEvent("nav_click", { target: "about" })}
            >
              About
            </NavLink>
            <NavLink
              to="/contact"
              className={({ isActive }) => `nav-btn ${isActive ? "nav-btn--active" : ""}`}
              onClick={() => trackEvent("nav_click", { target: "contact" })}
            >
              Contact
            </NavLink>
          </nav>
        </div>
      </header>

      <Routes>
        <Route path="/about" element={<About />} />
        <Route path="/contact" element={<Contact />} />
        <Route path="/" element={
          <div className={`workspace ${collapsed ? "workspace--collapsed" : ""}`}>
          <HistorySidebar
            entries={articleHistory.entries}
            status={articleHistory.status}
            activeId={articleHistory.activeId}
            busy={loading}
            pendingUrl={loading ? url : ""}
            collapsed={collapsed}
            open={drawerOpen}
            onSelect={handleSelectEntry}
            onNew={handleNewArticle}
            onRemove={handleRemoveEntry}
            onClear={handleClearHistory}
            onToggleCollapsed={toggleCollapsed}
            onClose={closeDrawer}
          />
          {drawerOpen && <div className="history-scrim" onClick={closeDrawer} aria-hidden="true" />}
          <main className="hero" id="top">
          <div className="hero__inner">
            <div className="header">
              <span className="wordmark">
                <span className="wordmark__mark" aria-hidden="true">
                  ✦
                </span>
                Sermon → Article
              </span>
              <h1>
                <span>Sermon</span>{" "}
                <span>Summarizer</span>
              </h1>
              <p className="tagline">
                Paste a YouTube sermon link and get a clean, ready-to-publish article.
              </p>
            </div>

            <form className="form" onSubmit={handleSubmit}>
              <div className="field">
                <span className="field__icon" aria-hidden="true">
                  ▶
                </span>
                <input
                  // text + inputMode, not type="url": the browser's own URL check
                  // rejects scheme-less links ("youtube.com/watch?v=…") that we accept.
                  type="text"
                  inputMode="url"
                  className="url-input"
                  placeholder="https://www.youtube.com/watch?v=…"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  required
                  autoComplete="off"
                  spellCheck="false"
                  aria-label="YouTube URL"
                  data-focus-fallback
                  ref={urlInputRef}
                />
              </div>
              <button
                type="submit"
                className="generate-btn"
                // aria-disabled, not disabled, while generating: a disabled
                // button drops keyboard focus to <body>. handleSubmit ignores
                // the click via the inFlight guard.
                disabled={!loading && !url.trim()}
                aria-disabled={loading || undefined}
              >
                {loading ? (
                  <>
                    <span className="dots" aria-hidden="true">
                      <i />
                      <i />
                      <i />
                    </span>
                    Generating…
                  </>
                ) : (
                  "Generate Article"
                )}
              </button>
              {loading && (
                <button type="button" className="cancel-btn" onClick={handleCancel}>
                  Cancel
                </button>
              )}
            </form>

            <p className="trust">
              <Lock size={13} aria-hidden="true" />
              Runs on your own free Gemini key, which never leaves your browser except to Google. We log which video was summarized, never the article or your key.
            </p>

            <p className="visually-hidden" role="status">
              {announcement}
            </p>
            {loading && (
              <p className="status" aria-hidden="true">
                {retrying
                  ? "Gemini was busy — trying once more."
                  : "Gemini is watching the sermon and writing the reflection. A full service can take a few minutes."}
                <span className="status__timer">{formatElapsed(elapsedMs)}</span>
              </p>
            )}

            {error && (
              <div className="error-container">
                <div className="error" role="alert">
                  <span className="error__icon" aria-hidden="true">
                    <AlertCircle size={16} strokeWidth={3} />
                  </span>
                  {error}
                </div>
              </div>
            )}

            {article && (
              <section className="result" ref={resultRef}>
                <div className="result-bar">
                  <span className="result-meta">
                    {stats.words.toLocaleString()} words · {stats.minutes} min read
                    {openedFromHistory && activeEntry && (
                      <span className="result-chip">
                        <History size={12} aria-hidden="true" />
                        From history · {shortDate(activeEntry.createdAt)}
                      </span>
                    )}
                    {savedFlash && (
                      <span className="result-chip result-chip--ok">
                        <Check size={12} aria-hidden="true" />
                        Saved
                      </span>
                    )}
                  </span>
                  <div className="result-actions">
                    {openedFromHistory && activeEntry && (
                      <button
                        type="button"
                        className="action-btn icon-only"
                        onClick={() => startGeneration(activeEntry.url)}
                        disabled={loading}
                        aria-label="Regenerate"
                        title="Regenerate this article"
                      >
                        <RotateCcw size={16} />
                      </button>
                    )}
                    <button
                      type="button"
                      className="action-btn icon-only"
                      onClick={handleCopy}
                      // Not until the client has accepted the result: text on
                      // screen mid-stream may still be rejected and discarded.
                      disabled={loading}
                      aria-label={copied ? "Copied" : "Copy text"}
                      title={loading ? "Available when the reflection is finished" : copied ? "Copied!" : "Copy Text"}
                    >
                      {copied ? <Check size={16} /> : <Copy size={16} />}
                    </button>
                  </div>
                  <span className="visually-hidden" aria-live="polite">
                    {copied ? "Article copied to clipboard" : ""}
                  </span>
                </div>
                <article className="article" aria-label="Generated article" tabIndex={0}>
                  {article}
                </article>
              </section>
            )}

            {saveFailed && (
              <div className="toast" role="status">
                <AlertCircle size={15} aria-hidden="true" />
                <span>Couldn&rsquo;t save to history. Copy the article now so you don&rsquo;t lose it.</span>
                <button type="button" className="toast__close" onClick={clearHistoryError} aria-label="Dismiss">
                  <X size={14} aria-hidden="true" />
                </button>
              </div>
            )}
          </div>
          </main>
          </div>
        } />
      </Routes>



      <footer className="footer">
        <span className="footer__copyright">
          &copy; 2026 {BRAND}. All rights reserved.
        </span>
        <span className="footer__credit">
          Made by <a href="https://ifeadese.com" target="_blank" rel="noopener noreferrer" onClick={() => trackEvent("outbound_click", { link_url: "https://ifeadese.com" })}>Ife Adese</a>
        </span>
      </footer>

      <ConnectGeminiModal
        open={modal.open}
        mode={modal.mode}
        initialError={modal.error}
        onConnected={handleConnected}
        onForget={handleForget}
        onClose={closeModal}
      />
    </div>
  );
}
