
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
            The process is entirely seamless: paste a YouTube sermon link and Gemini watches the video itself, sets aside the worship and announcements, structures the teaching into readable sections with clear headings, and keeps the scripture references exactly as they were preached. In a minute or two, you get a clean, copy-ready article that fully preserves the original message and voice of the speaker.
          </p>
          <p>
            <strong>How it stays free.</strong> Instead of us paying for every article, you connect your own Gemini key from Google AI Studio, which is free and takes about a minute. Your browser sends the video link and our writing instructions straight to Google. Nothing passes through our servers, and we never see your key.
          </p>
          <p>
            By transforming spoken sermons into structured, SEO-optimized text, we do more than save you time—we expand the reach of your ministry. Written summaries are indexable by search engines, easy to scan, and simple to repurpose into study guides, newsletters, or social media digests, keeping your community connected and fed throughout the week.
          </p>
        </div>
      </div>


    </main>
  );
}
