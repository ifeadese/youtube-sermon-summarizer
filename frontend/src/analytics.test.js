import {
  isAnalyticsEnabled,
  initAnalytics,
  trackEvent,
  trackPageView,
} from "./analytics.js";

// Enable the adapter the way production does: an ID *and* a production build.
function enable() {
  vi.stubEnv("VITE_GA_MEASUREMENT_ID", "G-TEST123");
  vi.stubEnv("PROD", true);
}

afterEach(() => {
  vi.unstubAllEnvs();
  delete window.gtag;
  vi.restoreAllMocks();
});

describe("analytics adapter", () => {
  it("is disabled when no measurement id is configured (dev/tests)", () => {
    expect(isAnalyticsEnabled()).toBe(false);
  });

  it("stays disabled outside a production build even if an id is set", () => {
    vi.stubEnv("VITE_GA_MEASUREMENT_ID", "G-TEST123"); // no PROD → still off (no localhost pollution)
    expect(isAnalyticsEnabled()).toBe(false);
  });

  it("is enabled only with an id AND a production build", () => {
    enable();
    expect(isAnalyticsEnabled()).toBe(true);
  });

  it("no-ops trackEvent when disabled, even if gtag exists", () => {
    const gtag = vi.fn();
    window.gtag = gtag;
    trackEvent("generate_submit", { url_valid: true });
    expect(gtag).not.toHaveBeenCalled();
  });

  it("sends events with a schema_version + params when enabled", () => {
    enable();
    const gtag = vi.fn();
    window.gtag = gtag;

    trackEvent("generate_success", { latency_ms: 1200, word_count: 600 });

    expect(gtag).toHaveBeenCalledWith("event", "generate_success", {
      schema_version: 1,
      latency_ms: 1200,
      word_count: 600,
    });
  });

  it("trackPageView emits a page_view with the path", () => {
    enable();
    const gtag = vi.fn();
    window.gtag = gtag;

    trackPageView("/about");

    expect(gtag).toHaveBeenCalledWith("event", "page_view", {
      schema_version: 1,
      page_path: "/about",
    });
  });

  it("initAnalytics is a no-op when disabled", () => {
    initAnalytics();
    expect(
      document.querySelector('script[src*="googletagmanager.com/gtag/js"]'),
    ).toBeNull();
    expect(window.gtag).toBeUndefined();
  });

  it("initAnalytics bootstraps gtag (send_page_view:false) and captures exceptions", () => {
    enable();
    const gtag = vi.fn();
    window.gtag = gtag; // pre-set so init uses our spy, not the dataLayer stub

    initAnalytics();

    // Loads the gtag.js script for the configured id.
    expect(
      document.querySelector('script[src*="googletagmanager.com/gtag/js?id=G-TEST123"]'),
    ).not.toBeNull();
    // Configures with manual (SPA) page_view handling.
    expect(gtag).toHaveBeenCalledWith("config", "G-TEST123", { send_page_view: false });

    // A global error surfaces as an `exception` event (observability).
    window.dispatchEvent(new ErrorEvent("error", { message: "boom" }));
    expect(gtag).toHaveBeenCalledWith(
      "event",
      "exception",
      expect.objectContaining({ description: "boom", fatal: false }),
    );

    // An unhandled promise rejection does too (its reason's message is used).
    window.dispatchEvent(
      Object.assign(new Event("unhandledrejection"), { reason: new Error("async boom") }),
    );
    expect(gtag).toHaveBeenCalledWith(
      "event",
      "exception",
      expect.objectContaining({ description: "async boom", fatal: false }),
    );
  });
});
