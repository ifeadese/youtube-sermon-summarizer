import { useEffect, useMemo, useRef, useState } from "react";
import { Routes, Route, Link, NavLink, useLocation } from "react-router-dom";
import { Copy, Check, AlertCircle } from "lucide-react";

import { generateArticle } from "./api.js";
import { initAnalytics, trackEvent, trackPageView } from "./analytics.js";
import About from "./About.jsx";
import Contact from "./Contact.jsx";
import "./App.css";

// Working brand name for the text logo. Swap to the final product name once the
// domain/naming decision (issue #34) lands.
const BRAND = "Sermon Summarizer";

function isValidYouTubeUrl(urlString) {
  try {
    const parsed = new URL(urlString);
    const host = parsed.hostname.replace(/^www\./, "");
    return host === "youtube.com" || host === "youtu.be" || host === "m.youtube.com";
  } catch {
    return false;
  }
}

function extractYouTubeVideoId(urlString) {
  try {
    const parsed = new URL(urlString);
    const host = parsed.hostname.replace(/^www\./, "");
    if (host === "youtu.be") {
      return parsed.pathname.slice(1);
    }
    if (parsed.pathname.startsWith("/shorts/")) {
      return parsed.pathname.split("/")[2];
    }
    return parsed.searchParams.get("v");
  } catch {
    return null;
  }
}

function extractDomain(urlString) {
  try {
    const parsed = new URL(urlString);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

// Single source of truth for word count — used by both the displayed reading
// stats and the generate_success analytics event, so they can't drift.
function countWords(text) {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

export default function App() {
  const [url, setUrl] = useState("");
  const [article, setArticle] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  // In-flight guard. A ref updates synchronously (unlike `loading` state, which
  // is stale within the same render), so a rapid second submit — e.g. two Enter
  // presses before the disabled button re-renders — can't fire a duplicate,
  // billed /summarize call.
  const inFlight = useRef(false);
  // Tracks the "Copied!" reset timer so we can clear it on a re-copy or unmount.
  const copyTimer = useRef(null);

  const location = useLocation();

  // Load analytics once (no-op unless VITE_GA_MEASUREMENT_ID is set).
  useEffect(() => {
    initAnalytics();
  }, []);

  // SPA navigations don't fire a page_view on their own — send one per route.
  useEffect(() => {
    trackPageView(location.pathname);
  }, [location.pathname]);

  // Clear any pending "Copied!" reset timer when the component unmounts.
  useEffect(() => () => clearTimeout(copyTimer.current), []);

  // Cheap reading stats for the result header (the prompt targets ~550–750 words).
  const stats = useMemo(() => {
    const words = countWords(article);
    return { words, minutes: Math.max(1, Math.round(words / 200)) };
  }, [article]);

  async function handleSubmit(event) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    setError("");
    setArticle("");
    setCopied(false);
    
    const trimmed = url.trim();
    
    if (!isValidYouTubeUrl(trimmed)) {
      trackEvent("invalid_url_attempt", { domain: extractDomain(trimmed) });
      setError("Please enter a valid YouTube URL.");
      setLoading(false);
      inFlight.current = false;
      return;
    }

    const videoId = extractYouTubeVideoId(trimmed);
    trackEvent("generate_submit", { video_id: videoId });
    
    const startedAt = Date.now();
    try {
      const result = await generateArticle(trimmed);
      setArticle(result);
      trackEvent("generate_success", {
        video_id: videoId,
        latency_ms: Date.now() - startedAt,
        word_count: countWords(result),
      });
    } catch (err) {
      setError(err.message);
      trackEvent("generate_error", {
        error_type: err?.type || "unknown",
        status: err?.status || 0,
      });
    } finally {
      setLoading(false);
      inFlight.current = false;
    }
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
                Paste a captioned YouTube sermon link and get a clean, ready-to-publish article.
              </p>
            </div>

            <form className="form" onSubmit={handleSubmit}>
              <div className="field">
                <span className="field__icon" aria-hidden="true">
                  ▶
                </span>
                <input
                  type="url"
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
            </form>

            {loading && (
              <p className="status" role="status">
                Fetching the transcript and writing the article — this can take up to a minute.
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
                <article className="article" aria-label="Generated article">
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
    </div>
  );
}
