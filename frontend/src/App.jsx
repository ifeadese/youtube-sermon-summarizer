import { useState } from "react";

import { generateArticle } from "./api.js";
import "./App.css";

export default function App() {
  const [url, setUrl] = useState("");
  const [article, setArticle] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setArticle("");
    try {
      setArticle(await generateArticle(url.trim()));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
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
        <article className="article" aria-label="Generated article">
          {article}
        </article>
      )}
    </main>
  );
}
