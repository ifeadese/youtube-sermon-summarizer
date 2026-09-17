import { useEffect, useMemo, useRef, useState } from "react";
import { Routes, Route, Link, NavLink, useLocation } from "react-router-dom";
import { Copy, Check, AlertCircle, Lock } from "lucide-react";

import { canonicalizeYouTubeUrl, generateReflection, MODEL } from "./lib/gemini.js";
import { clearKey, getKey, setKey } from "./lib/keyStore.js";
import { initAnalytics, trackEvent, trackPageView } from "./analytics.js";
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

const CLOSED_MODAL = { open: false, mode: "connect", error: "" };

export default function App() {
  const [url, setUrl] = useState("");
  const [article, setArticle] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [hasKey, setHasKey] = useState(() => Boolean(getKey()));
  const [modal, setModal] = useState(CLOSED_MODAL);

  const inFlight = useRef(false);
  const copyTimer = useRef(null);
  const abortRef = useRef(null);
  // A URL submitted before a key existed; generated as soon as the key connects.
  const pendingUrl = useRef("");

  const location = useLocation();

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
    setLoading(true);
    setError("");
    setArticle("");
    setCopied(false);

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
      });
      setArticle(result);
      trackEvent("generate_success", {
        ...meta,
        latency_ms: Date.now() - startedAt,
        first_text_ms: firstTextAt ? firstTextAt - startedAt : 0,
        word_count: countWords(result),
      });
    } catch (err) {
      setArticle("");
      if (err?.type === "cancelled") {
        trackEvent("generate_cancel", { ...meta, latency_ms: Date.now() - startedAt });
      } else if (err?.type === "invalid_key") {
        // The stored key stopped working (revoked, or pasted wrong): forget it
        // and ask again, keeping the URL so the retry is one click.
        clearKey();
        setHasKey(false);
        pendingUrl.current = targetUrl;
        openModal("connect", err.message);
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
    if (next) runGeneration(next, key);
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
                />
              </div>
              <button type="submit" className="generate-btn" disabled={loading || !url.trim()}>
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

            {loading && (
              <p className="status" role="status">
                Gemini is watching the sermon and writing the reflection — usually a minute or two.
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
              <section className="result">
                <div className="result-bar">
                  <span className="result-meta">
                    {stats.words.toLocaleString()} words · {stats.minutes} min read
                  </span>
                  <div className="result-actions">
                    <button
                      type="button"
                      className="action-btn icon-only"
                      onClick={handleCopy}
                      aria-label={copied ? "Copied" : "Copy text"}
                      title={copied ? "Copied!" : "Copy Text"}
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
