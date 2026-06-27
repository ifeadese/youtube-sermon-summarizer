import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useFormSubmission } from "./hooks/useFormSubmission.js";
import { DEFAULT_FORMBOLD_SUBMIT_URL } from "./lib/formbold.js";
import { trackEvent } from "./analytics.js";

const INITIAL_FORM_DATA = {
  name: "",
  email: "",
  subject: "",
  message: "",
};

// How long the "Confirm?" state lingers before reverting (ms).
const CONFIRM_TIMEOUT = 3000;

export default function Contact() {
  const { formData, isSubmitting, submitStatus, handleChange, handleSubmit } =
    useFormSubmission(INITIAL_FORM_DATA, {
      submitEndpoint: DEFAULT_FORMBOLD_SUBMIT_URL,
      successMessage:
        "Thank you for reaching out! We'll get back to you shortly.",
      onSuccess: () => trackEvent("contact_success"),
    });

  const [confirming, setConfirming] = useState(false);
  const confirmTimer = useRef(null);

  const error = submitStatus.type === "error" ? submitStatus.message : null;

  // Surface submission failures to analytics (observability). All *_error events
  // share an `error_type`; `description` rides along as optional context.
  useEffect(() => {
    if (submitStatus.type === "error") {
      trackEvent("contact_error", { error_type: "submit_failed", description: submitStatus.message });
    }
  }, [submitStatus]);

  function handleTrackedSubmit(event) {
    trackEvent("contact_submit");
    handleSubmit(event);
  }

  function handleButtonClick(event) {
    if (isSubmitting) return;

    if (!confirming) {
      // First click — enter confirmation state, don't submit yet.
      event.preventDefault();
      setConfirming(true);
      clearTimeout(confirmTimer.current);
      confirmTimer.current = setTimeout(() => setConfirming(false), CONFIRM_TIMEOUT);
    } else {
      // Second click — let the native form submit fire.
      clearTimeout(confirmTimer.current);
      setConfirming(false);
    }
  }

  if (submitStatus.type === "success") {
    return (
      <main className="contact-page">
        <div className="contact-success" role="status">
          <span className="contact-success__icon" aria-hidden="true">
            ✓
          </span>
          <h2 className="contact-success__heading">Message Sent!</h2>
          <p className="contact-success__body">{submitStatus.message}</p>
          <Link to="/" className="contact-home-btn" onClick={() => trackEvent("nav_click", { target: "home" })}>
            Back to Home
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="contact-page">
      <div className="contact-hero">
        <span className="wordmark">
          <span className="wordmark__mark" aria-hidden="true">
            ✦
          </span>
          Get in Touch
        </span>
        <h1 className="contact-title">Contact</h1>
        <p className="contact-subtitle">
          Have a question, feedback, or something to share with us? We'd love to
          hear from you.
        </p>
      </div>

      {error && (
        <div className="error" role="alert">
          <span className="error__icon" aria-hidden="true">
            !
          </span>
          {error}
        </div>
      )}

      <form className="contact-form" onSubmit={handleTrackedSubmit}>
        <div className="contact-field">
          <label htmlFor="contact-name" className="contact-label">
            Name <span className="contact-required" aria-hidden="true">*</span>
          </label>
          <input
            type="text"
            id="contact-name"
            name="name"
            required
            minLength={2}
            value={formData.name}
            onChange={handleChange}
            className="contact-input"
            placeholder="Your full name"
            autoComplete="name"
          />
        </div>

        <div className="contact-field">
          <label htmlFor="contact-email" className="contact-label">
            Email{" "}
            <span className="contact-required" aria-hidden="true">*</span>
          </label>
          <input
            type="email"
            id="contact-email"
            name="email"
            required
            value={formData.email}
            onChange={handleChange}
            className="contact-input"
            placeholder="you@example.com"
            autoComplete="email"
          />
        </div>

        <div className="contact-field">
          <label htmlFor="contact-subject" className="contact-label">
            Subject{" "}
            <span className="contact-required" aria-hidden="true">*</span>
          </label>
          <input
            type="text"
            id="contact-subject"
            name="subject"
            required
            minLength={3}
            value={formData.subject}
            onChange={handleChange}
            className="contact-input"
            placeholder="What is this about?"
          />
        </div>

        <div className="contact-field">
          <label htmlFor="contact-message" className="contact-label">
            Message{" "}
            <span className="contact-required" aria-hidden="true">*</span>
          </label>
          <textarea
            id="contact-message"
            name="message"
            required
            rows={6}
            value={formData.message}
            onChange={handleChange}
            className="contact-input contact-textarea"
            placeholder="Tell us what's on your mind…"
          />
        </div>

        <button
          type="submit"
          className={`contact-submit${confirming ? " contact-submit--confirm" : ""}`}
          disabled={isSubmitting}
          onClick={handleButtonClick}
        >
          {isSubmitting ? (
            <>
              <span className="dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              Sending…
            </>
          ) : confirming ? (
            "Confirm Send?"
          ) : (
            "Send Message"
          )}
        </button>
      </form>
    </main>
  );
}
