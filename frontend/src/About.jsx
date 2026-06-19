import { Link } from "react-router-dom";

export default function About() {
  return (
    <main className="about-page">
      <div className="about-hero">
        <span className="wordmark">
          <span className="wordmark__mark" aria-hidden="true">✦</span>
          Our Vision
        </span>
        <h1 className="about-title">About Sermon Summarizer</h1>

      </div>

      <div className="about-mission">
        <div className="about-mission__card">

          <p>
            Sermons are rich with wisdom, guidance, and inspiration, but their impact is often confined to the hour of delivery or lost inside hours of video archives.
          </p>
          <p>
            <strong>Sermon Summarizer</strong> was built to solve this. We extract the spoken content of your sermon, strip away verbal fillers, and intelligently restructure it into a beautifully written, readable, and highly engaging article. Whether you're publishing weekly recaps, crafting newsletters, or expanding your digital library, we make your message accessible to everyone.
          </p>
          <p>
            The process is entirely seamless: by simply pasting a YouTube sermon link, the platform automatically retrieves the transcript, resolves verbal repetitions, structures readability blocks, inserts clear headings, and extracts scripture references. In a matter of seconds, you get a clean, copy-ready article that fully preserves the original message and voice of the speaker.
          </p>
          <p>
            By transforming spoken sermons into structured, SEO-optimized text, we do more than save you time—we expand the reach of your ministry. Written summaries are indexable by search engines, easy to scan, and simple to repurpose into study guides, newsletters, or social media digests, keeping your community connected and fed throughout the week.
          </p>
        </div>
      </div>


    </main>
  );
}
