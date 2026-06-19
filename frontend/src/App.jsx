import { useEffect, useMemo, useRef, useState } from "react";
import { Routes, Route, Link, NavLink } from "react-router-dom";

import { generateArticle } from "./api.js";
import About from "./About.jsx";
import Contact from "./Contact.jsx";
import "./App.css";

// Working brand name for the text logo. Swap to the final product name once the
// domain/naming decision (issue #34) lands.
const BRAND = "Sermon Summarizer";
// Placeholder until the real contact email is provided (issue #35). Swap before merge.
const CONTACT_EMAIL = "hello@example.com";

function isValidYouTubeUrl(urlString) {
  try {
    const parsed = new URL(urlString);
    const host = parsed.hostname.replace(/^www\./, "");
    return host === "youtube.com" || host === "youtu.be" || host === "m.youtube.com";
  } catch {
    return false;
  }
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

  // Clear any pending "Copied!" reset timer when the component unmounts.
  useEffect(() => () => clearTimeout(copyTimer.current), []);

  // Cheap reading stats for the result header (the prompt targets ~550–750 words).
  const stats = useMemo(() => {
    const words = article.trim() ? article.trim().split(/\s+/).length : 0;
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
    try {
      setArticle(await generateArticle(url.trim()));
    } catch (err) {
      setError(err.message);
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
    } catch {
      setError("Couldn't copy to the clipboard — please select and copy the text manually.");
    }
  }

  return (
    <div className="page">
      <header className="topbar">
        <Link className="brand" to="/" aria-label={`${BRAND} home`}>
          <span className="brand__mark" aria-hidden="true">
            ✦
          </span>
          {BRAND}
        </Link>
        <nav className="nav" aria-label="Primary">
          <NavLink
            to="/about"
            className={({ isActive }) => `nav-btn ${isActive ? "nav-btn--active" : ""}`}
          >
            About
          </NavLink>
          <NavLink
            to="/contact"
            className={({ isActive }) => `nav-btn ${isActive ? "nav-btn--active" : ""}`}
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
              <button type="submit" className="generate-btn" disabled={loading || !isValidYouTubeUrl(url.trim())}>
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
              <p className="error" role="alert">
                <span className="error__icon" aria-hidden="true">
                  !
                </span>
                {error}
              </p>
            )}

            {article && (
              <section className="result">
                <div className="result-bar">
                  <span className="result-meta">
                    {stats.words.toLocaleString()} words · {stats.minutes} min read
                  </span>
                  <button type="button" className="copy-btn" onClick={handleCopy}>
                    <span className="copy-btn__icon" aria-hidden="true">
                      {copied ? "✓" : "⧉"}
                    </span>
                    {copied ? "Copied!" : "Copy Article"}
                  </button>
                  <span className="visually-hidden" aria-live="polite">
                    {copied ? "Article copied to clipboard" : ""}
                  </span>
                </div>
                {/* Fixed-height, vertically-scrollable so a long article scrolls
                    inside its box instead of stretching the page. */}
                <div className="article-scroll">
                  <article className="article" aria-label="Generated article">
                    {article}
                  </article>
                </div>
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
          Made by <a href="https://ifeadese.com" target="_blank" rel="noopener noreferrer">Ife Adese</a>
        </span>
      </footer>
    </div>
  );
}
