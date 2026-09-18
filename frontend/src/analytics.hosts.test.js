// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://sermon-summarizer-git-some-branch-user.vercel.app/" }
import { afterEach, describe, expect, it, vi } from "vitest";

import { initAnalytics, isAnalyticsEnabled, trackEvent } from "./analytics.js";

afterEach(() => {
  vi.unstubAllEnvs();
  delete window.gtag;
});

describe("analytics on a non-production host (preview deployment)", () => {
  it("stays disabled even in a production build with the measurement id set", () => {
    vi.stubEnv("VITE_GA_MEASUREMENT_ID", "G-TEST123");
    vi.stubEnv("PROD", true);
    expect(window.location.hostname).toBe("sermon-summarizer-git-some-branch-user.vercel.app");
    expect(isAnalyticsEnabled()).toBe(false);
    initAnalytics();
    expect(document.querySelector("script[src*='googletagmanager']")).toBeNull();
    const gtag = vi.fn();
    window.gtag = gtag;
    trackEvent("generate_submit", { provider: "gemini" });
    expect(gtag).not.toHaveBeenCalled();
  });
});
