/**
 * GA4 analytics adapter.
 *
 * Env-driven: loads gtag.js dynamically only when `VITE_GA_MEASUREMENT_ID` is
 * set, so local dev and the test suite are automatic no-ops (no polluted data,
 * deterministic tests). Every event in the app routes through `trackEvent` /
 * `trackPageView`, so behaviour — including any future consent gating — lives in
 * this one place. The measurement ID is client-exposed by nature (not a secret)
 * but stays in the env so it's never hardcoded in the repo.
 */

// Bump on any breaking change to event names/params so historical data and
// future A/A baselines stay comparable. See issue #45 (event governance).
// v2: generation runs in the browser on the user's own Gemini key —
// generate_* events gain `provider` + `model` and keep `video_id`, which the
// page discloses ("We log which video was summarized"); new connect_open /
// connect_success / connect_error / key_forgotten / generate_cancel /
// generate_retry events. error_type values come from the client's error
// types (see lib/gemini.js USER_MESSAGES). Never put the key (or any part of
// it) in an event.
// v2 additions (non-breaking): history_error {op, error_type} when the
// article-history store fails; never the article or the key.
const SCHEMA_VERSION = 2;

// Only the production site reports. Preview deployments are built with the
// same env, so an env check alone would send every reviewer's clicks to the
// production property.
const PRODUCTION_HOSTS = new Set(["sermon-summarizer.com", "www.sermon-summarizer.com", "youtube-sermon-summarizer.vercel.app"]);

let initialized = false;

function measurementId() {
  return import.meta.env.VITE_GA_MEASUREMENT_ID || "";
}

// Enabled only in a production build, with an ID configured, served from the
// production host. Gating on PROD (not just the env var) guarantees the no-op
// in dev/tests even if someone sets VITE_GA_MEASUREMENT_ID locally; gating on
// the host keeps preview deployments out of the production property.
export function isAnalyticsEnabled() {
  const hostname = typeof window === "undefined" ? "" : window.location.hostname;
  return Boolean(measurementId()) && Boolean(import.meta.env.PROD) && PRODUCTION_HOSTS.has(hostname);
}

/**
 * Load gtag.js once and start the SDK. No-op when unconfigured (dev/tests) or
 * already initialized. Safe to call on every mount.
 */
export function initAnalytics() {
  if (!isAnalyticsEnabled() || initialized || typeof window === "undefined" || typeof document === "undefined") {
    return;
  }
  const id = measurementId();
  initialized = true;

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${id}`;
  document.head.appendChild(script);

  window.dataLayer = window.dataLayer || [];
  if (typeof window.gtag !== "function") {
    window.gtag = function gtag() {
      window.dataLayer.push(arguments);
    };
  }
  window.gtag("js", new Date());
  // We emit page_view manually on SPA route changes, so disable the automatic one.
  window.gtag("config", id, { send_page_view: false });

  // Make otherwise-invisible client errors observable (issue #45 — visibility
  // when things go wrong). These listeners intentionally live for the page
  // lifetime: initAnalytics runs once (guarded above), the app is never
  // unmounted in production, and there's nothing to tear down.
  window.addEventListener("error", (event) => {
    trackEvent("exception", { description: truncate(event.message), fatal: false });
  });
  window.addEventListener("unhandledrejection", (event) => {
    trackEvent("exception", { description: truncate(reasonText(event.reason)), fatal: false });
  });
}

/** Send a GA4 event. No-op unless analytics is configured and loaded. */
export function trackEvent(name, params = {}) {
  if (!isAnalyticsEnabled() || typeof window === "undefined" || typeof window.gtag !== "function") {
    return;
  }
  window.gtag("event", name, { schema_version: SCHEMA_VERSION, ...params });
}

/** Send a manual SPA page_view (router navigation doesn't fire one). */
export function trackPageView(path) {
  trackEvent("page_view", { page_path: path });
}

function truncate(value, max = 300) {
  const s = typeof value === "string" ? value : String(value ?? "");
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function reasonText(reason) {
  return reason instanceof Error ? reason.message : String(reason ?? "");
}
