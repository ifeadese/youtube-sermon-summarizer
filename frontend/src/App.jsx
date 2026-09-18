import { useEffect, useMemo, useRef, useState } from "react";
import { Routes, Route, Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { Copy, Check, AlertCircle, Lock } from "lucide-react";

import { canonicalizeYouTubeUrl, generateReflection, MODEL } from "./lib/gemini.js";
import { clearKey, getKey, setKey, subscribeToKeyChanges } from "./lib/keyStore.js";
import { initAnalytics, trackEvent, trackPageView } from "./analytics.js";
import { useHistory } from "./history/useHistory.js";
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

  const inFlight = useRef(false);
  const copyTimer = useRef(null);
  const abortRef = useRef(null);
  // A URL submitted before a key existed; generated as soon as the key connects.
  const pendingUrl = useRef("");
  const startedAtRef = useRef(0);
  const resultRef = useRef(null);
  const scrolledToResult = useRef(false);

  const location = useLocation();
  const navigate = useNavigate();
  // Every finished article is kept (in this browser, for now) and listed in
  // the sidebar. Saving is best-effort: a failing store never blocks the result.
  const articleHistory = useHistory();
  const historyError = articleHistory.error;

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
    if (inFlight.current) return;

    // One definition of "a YouTube video link", shared with the client: a
    // playlist or channel page is refused here, before the key dialog opens,
    // and music./scheme-less/timestamped links are accepted and normalised.
    const videoUrl = canonicalizeYouTubeUrl(url);
    if (!videoUrl) {
      trackEvent("invalid_url_attempt", { domain: extractDomain(url.trim()) });
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
      await articleHistory.save({ url: targetUrl, article: result, provider: PROVIDER, model: MODEL });
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
                  </span>
                  <div className="result-actions">
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


          </div>
          </main>
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
