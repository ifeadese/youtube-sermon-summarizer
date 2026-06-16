export default function About({ onBackToHome }) {
  return (
    <main className="about-page">
      <div className="about-hero">
        <span className="wordmark">
          <span className="wordmark__mark" aria-hidden="true">✦</span>
          Our Vision
        </span>
        <h1 className="about-title">About Sermon Summarizer</h1>
        <p className="about-subtitle">
          Bridging the gap between spoken word and the written page. We help ministries amplify their message.
        </p>
      </div>

      <div className="about-mission">
        <div className="about-mission__card">
          <h2>Our Purpose</h2>
          <p>
            Sermons are rich with wisdom, guidance, and inspiration, but their impact is often confined to the hour of delivery or lost inside hours of video archives.
          </p>
          <p>
            <strong>Sermon Summarizer</strong> was built to solve this. We extract the spoken content of your sermon, strip away verbal fillers, and intelligently restructure it into a beautifully written, readable, and highly engaging article. Whether you're publishing weekly recaps, crafting newsletters, or expanding your digital library, we make your message accessible to everyone.
          </p>
        </div>
      </div>

      <div className="about-tech">
        <h2>How It Works</h2>
        <p className="about-section-lead">Three simple steps to transition your message from pulpit to print.</p>
        <div className="about-grid">
          <div className="about-card">
            <div className="about-card__num">1</div>
            <h3>Audio Extraction</h3>
            <p>
              Simply paste the link to your YouTube video. We securely fetch the sermon's transcript and align the content structure.
            </p>
          </div>

          <div className="about-card">
            <div className="about-card__num">2</div>
            <h3>Synthesis & Polish</h3>
            <p>
              Our system cleans formatting, corrects grammar, sections key topics, and extracts scripture references while preserving the unique voice of the speaker.
            </p>
          </div>

          <div className="about-card">
            <div className="about-card__num">3</div>
            <h3>Ready to Publish</h3>
            <p>
              Copy the resulting recap with a single click. It's ready to upload directly to your website, blog, or community platform.
            </p>
          </div>
        </div>
      </div>

      <div className="about-cta">
        <button type="button" className="generate-btn" onClick={onBackToHome}>
          Back to Summarizer
        </button>
      </div>
    </main>
  );
}
