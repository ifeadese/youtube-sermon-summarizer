import { useRef, useState } from "react";

import { generateArticle } from "./api.js";
import "./App.css";

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
  // Tracks the "Copied!" reset timer so we can clear it on a re-copy/unmount.
  const copyTimer = useRef(null);

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
      setCopied(true);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't copy to the clipboard — please select and copy the text manually.");
    }
  }

  return (
    <main className="app">
      <header className="header">
        <h1>YouTube Sermon Summarizer</h1>
        <p className="tagline">
          Paste a YouTube sermon link and get a ready-to-publish article.
        </p>
      </header>

      <form className="form" onSubmit={handleSubmit}>
        <input
          type="url"
          className="url-input"
          placeholder="https://www.youtube.com/watch?v=..."
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          required
          aria-label="YouTube URL"
        />
        <button type="submit" className="generate-btn" disabled={loading || !url.trim()}>
          {loading ? "Generating…" : "Generate Article"}
        </button>
      </form>

      {loading && (
        <p className="status" role="status">
          Fetching the transcript and writing the article — this can take up to a minute.
        </p>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {article && (
        <section className="result">
          <div className="result-bar">
            <button type="button" className="copy-btn" onClick={handleCopy}>
              {copied ? "Copied!" : "Copy Article"}
            </button>
          </div>
          <article className="article" aria-label="Generated article">
            {article}
          </article>
        </section>
      )}
    </main>
  );
}
