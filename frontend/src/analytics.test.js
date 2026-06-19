import { isAnalyticsEnabled, trackEvent, trackPageView } from "./analytics.js";

afterEach(() => {
  vi.unstubAllEnvs();
  delete window.gtag;
  vi.restoreAllMocks();
});

describe("analytics adapter", () => {
  it("is disabled when no measurement id is configured (dev/tests)", () => {
    expect(isAnalyticsEnabled()).toBe(false);
  });

  it("no-ops trackEvent when disabled, even if gtag exists", () => {
    const gtag = vi.fn();
    window.gtag = gtag;
    trackEvent("generate_submit", { url_valid: true });
    expect(gtag).not.toHaveBeenCalled();
  });

  it("is enabled when a measurement id is set", () => {
    vi.stubEnv("VITE_GA_MEASUREMENT_ID", "G-TEST123");
    expect(isAnalyticsEnabled()).toBe(true);
  });

  it("sends events with a schema_version + params when enabled", () => {
    vi.stubEnv("VITE_GA_MEASUREMENT_ID", "G-TEST123");
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
    vi.stubEnv("VITE_GA_MEASUREMENT_ID", "G-TEST123");
    const gtag = vi.fn();
    window.gtag = gtag;

    trackPageView("/about");

    expect(gtag).toHaveBeenCalledWith("event", "page_view", {
      schema_version: 1,
      page_path: "/about",
    });
  });
});
