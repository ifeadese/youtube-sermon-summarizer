import { render, screen, fireEvent, act, within, waitFor } from "@testing-library/react";

import { MemoryRouter } from "react-router-dom";
import App from "./App.jsx";
import { trackEvent, trackPageView } from "./analytics.js";
import { generateReflection, validateKey } from "./lib/gemini.js";
import { clearKey, getKey, setKey } from "./lib/keyStore.js";

// Analytics is mocked file-wide: the existing tests don't assert on it (the
// mocked fns are harmless no-ops), and the analytics-specific tests below assert
// the right events fire with the right params.
vi.mock("./analytics.js", () => ({
  initAnalytics: vi.fn(),
  trackEvent: vi.fn(),
  trackPageView: vi.fn(),
  isAnalyticsEnabled: vi.fn(() => false),
}));

// The Gemini client is mocked at the module boundary: these tests cover the
// UI's behaviour around it (connect flow, streaming, errors), while
// lib/gemini.test.js covers the wire format.
vi.mock("./lib/gemini.js", async (importOriginal) => ({
  ...(await importOriginal()), // keep the real canonicalizeYouTubeUrl
  generateReflection: vi.fn(),
  validateKey: vi.fn(),
  MODEL: "gemini-test-model",
}));

const KEY = "AIzaTESTKEY00000000000000000000000000000";
const URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

beforeEach(() => {
  vi.clearAllMocks();
  clearKey();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Put a key in place so Generate goes straight to generation. */
function connectKey() {
  setKey(KEY, { remember: true });
}

/** Make generateReflection stream `text` in one delta and resolve with it. */
function mockArticle(text) {
  generateReflection.mockImplementation(async ({ onDelta }) => {
    onDelta?.(text);
    return text;
  });
}

function mockFailure(type, message, status, extra = {}) {
  generateReflection.mockRejectedValue(Object.assign(new Error(message), { type, status, ...extra }));
}

function renderApp(initialEntries = ["/"]) {
  return render(<MemoryRouter initialEntries={initialEntries}><App /></MemoryRouter>);
}

function typeUrl(value = URL) {
  fireEvent.change(screen.getByLabelText("YouTube URL"), { target: { value } });
}

function clickGenerate() {
  fireEvent.click(screen.getByRole("button", { name: "Generate Article" }));
}

const dialog = () => screen.getByRole("dialog");
// The visible loading line (aria-hidden); the live region carries a different sentence.
const WATCHING = /A full service can take a few minutes/;
const waitForGenerating = () => screen.findByText(WATCHING);
const status = () => screen.getByRole("status");

describe("App", () => {
  it("renders the app heading (the #8 acceptance criterion)", () => {
    renderApp();
    expect(
      screen.getByRole("heading", { name: "Sermon Summarizer" }),
    ).toBeInTheDocument();
  });

  it("shows an error and tracks invalid_url_attempt when submitting an invalid URL", async () => {
    renderApp();
    const button = screen.getByRole("button", { name: "Generate Article" });
    expect(button).toBeDisabled(); // disabled when empty

    typeUrl("https://example.com/not-youtube");
    expect(button).toBeEnabled(); // enabled when not empty

    clickGenerate();
    expect(await screen.findByRole("alert")).toHaveTextContent("Please enter a valid YouTube URL.");
    expect(trackEvent).toHaveBeenCalledWith("invalid_url_attempt", { domain: "example.com" });
    expect(generateReflection).not.toHaveBeenCalled();
  });

  it.each(["https://www.youtube.com/playlist?list=PL123", "https://www.youtube.com/@somechurch", "https://www.youtube.com/watch?v=short"])(
    "refuses %j up front, without opening the key dialog",
    async (link) => {
      renderApp();
      typeUrl(link);
      clickGenerate();
      expect(await screen.findByRole("alert")).toHaveTextContent("Please enter a valid YouTube URL.");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(generateReflection).not.toHaveBeenCalled();
    },
  );

  it.each([
    "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
    "youtube.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30s",
    "https://www.youtube.com/live/dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ?si=abc",
  ])("accepts %j and sends the canonical video URL", async (link) => {
    connectKey();
    mockArticle("ok");
    renderApp();
    typeUrl(link);
    const form = screen.getByLabelText("YouTube URL").closest("form");
    fireEvent.submit(form); // a scheme-less link fails the browser's type=url check, so submit directly
    await screen.findByLabelText("Generated article");
    expect(generateReflection.mock.calls[0][0].url).toBe(URL);
  });

  it("shows the streamed reflection on success", async () => {
    connectKey();
    mockArticle("My Title\n\nA fine article.");
    renderApp();
    typeUrl();
    clickGenerate();

    const article = await screen.findByLabelText("Generated article");
    expect(article).toHaveTextContent("My Title");
    expect(article).toHaveTextContent("A fine article.");
  });

  it("appends text as deltas arrive, then shows the final text", async () => {
    connectKey();
    let sendDelta;
    let finish;
    generateReflection.mockImplementation(({ onDelta }) => new Promise((resolve) => {
      sendDelta = onDelta;
      finish = resolve;
    }));
    renderApp();
    typeUrl();
    clickGenerate();

    await waitForGenerating();
    act(() => sendDelta("Grace "));
    expect(await screen.findByLabelText("Generated article")).toHaveTextContent("Grace");
    // Copy is not offered on text the client may still reject.
    expect(screen.getByRole("button", { name: /copy text/i })).toBeDisabled();
    act(() => sendDelta("and peace."));
    expect(screen.getByLabelText("Generated article")).toHaveTextContent("Grace and peace.");

    await act(async () => finish("Grace and peace."));
    expect(screen.queryByText(WATCHING)).not.toBeInTheDocument();
    expect(status()).toHaveTextContent("Reflection ready, 3 words.");
    expect(screen.getByLabelText("Generated article")).toHaveTextContent("Grace and peace.");
    expect(screen.getByRole("button", { name: /copy text/i })).toBeEnabled();
  });

  it("shows the client's friendly message for a typed failure", async () => {
    connectKey();
    mockFailure("private_video", "Gemini couldn't open that video.", 0);
    renderApp();
    typeUrl();
    clickGenerate();

    expect(await screen.findByRole("alert")).toHaveTextContent("Gemini couldn't open that video.");
    expect(screen.queryByLabelText("Generated article")).not.toBeInTheDocument();
  });

  it("shows a reachability message when the request fails at the network level", async () => {
    connectKey();
    mockFailure("network", "Could not reach Gemini. Please check your connection and try again.");
    renderApp();
    typeUrl();
    clickGenerate();

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach Gemini");
  });

  it("shows a timeout message when the request times out", async () => {
    connectKey();
    mockFailure("timeout", "This took too long and was cancelled. Please try again.");
    renderApp();
    typeUrl();
    clickGenerate();

    expect(await screen.findByRole("alert")).toHaveTextContent("took too long");
  });

  it("shows a friendly message when the stream carries no text", async () => {
    connectKey();
    mockFailure("empty", "Gemini returned an empty reflection. Please try again.");
    renderApp();
    typeUrl();
    clickGenerate();

    expect(await screen.findByRole("alert")).toHaveTextContent("empty reflection");
    expect(screen.queryByLabelText("Generated article")).not.toBeInTheDocument();
  });

  it("trims the URL and passes the stored key to the client", async () => {
    connectKey();
    mockArticle("ok");
    renderApp();
    typeUrl(`   ${URL}   `);
    clickGenerate();

    await screen.findByLabelText("Generated article");
    expect(generateReflection).toHaveBeenCalledTimes(1);
    const args = generateReflection.mock.calls[0][0];
    expect(args.url).toBe(URL);
    expect(args.key).toBe(KEY);
    expect(args.signal).toBeInstanceOf(AbortSignal);
  });

  it("ignores a rapid second submit while one request is in flight", async () => {
    connectKey();
    let finish;
    generateReflection.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    renderApp();
    typeUrl();

    const form = screen.getByLabelText("YouTube URL").closest("form");
    fireEvent.submit(form);
    fireEvent.submit(form); // second submit before the first resolves

    expect(generateReflection).toHaveBeenCalledTimes(1);

    await act(async () => finish("done"));
    await screen.findByLabelText("Generated article");
  });

  it("shows a status and Cancel while in flight, then clears on completion", async () => {
    connectKey();
    let finish;
    generateReflection.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    renderApp();
    typeUrl();
    clickGenerate();

    await waitForGenerating();
    expect(status()).toHaveTextContent("Generating");
    // aria-disabled, not disabled: a disabled button would drop focus to <body>.
    const generate = screen.getByRole("button", { name: /generat/i });
    expect(generate).toHaveAttribute("aria-disabled", "true");
    expect(generate).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();

    await act(async () => finish("done"));

    await screen.findByLabelText("Generated article");
    expect(screen.queryByText(WATCHING)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate Article" })).not.toHaveAttribute("aria-disabled");
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    // After completion both Generate and Copy buttons exist — target Generate.
    expect(screen.getByRole("button", { name: "Generate Article" })).toBeEnabled();
  });

  it.each([
    ["too_short", "Gemini returned something too short to be a reflection. Please try again."],
    ["no_sermon", "Gemini didn't find a sermon or teaching in that video. Try the link to the message itself."],
    ["video_not_read", "Gemini couldn't read the video itself, so nothing reliable could be written."],
    ["truncated", "Gemini ran out of room before finishing the reflection. Please try again."],
  ])("discards text that already streamed when the client rejects late with %s", async (type, message) => {
    // These checks run after the stream ends, so the reader has already seen the text.
    connectKey();
    let sendDelta;
    let fail;
    generateReflection.mockImplementation(({ onDelta }) => new Promise((_, reject) => {
      sendDelta = onDelta;
      fail = reject;
    }));
    renderApp();
    typeUrl();
    clickGenerate();

    await waitForGenerating();
    act(() => sendDelta("A confident-looking paragraph that is not a reflection of the sermon."));
    expect(await screen.findByLabelText("Generated article")).toHaveTextContent("confident-looking");

    await act(async () => fail(Object.assign(new Error(message), { type })));

    expect(screen.queryByLabelText("Generated article")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /copy text/i })).not.toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(trackEvent).toHaveBeenCalledWith("generate_error", expect.objectContaining({ error_type: type }));
  });

  it("Cancel aborts the request, discards partial text, and shows no error", async () => {
    connectKey();
    generateReflection.mockImplementation(({ signal, onDelta }) => new Promise((_, reject) => {
      onDelta("partial ");
      signal.addEventListener("abort", () =>
        reject(Object.assign(new Error("Generation cancelled."), { type: "cancelled" })),
      );
    }));
    renderApp();
    typeUrl();
    clickGenerate();

    expect(await screen.findByLabelText("Generated article")).toHaveTextContent("partial");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByText(WATCHING)).not.toBeInTheDocument());
    expect(status()).toHaveTextContent("Generation cancelled.");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Generated article")).not.toBeInTheDocument();
    expect(trackEvent).toHaveBeenCalledWith("generate_cancel", expect.objectContaining({ provider: "gemini" }));
    expect(screen.getByRole("button", { name: "Generate Article" })).toBeEnabled();
  });
});

describe("Connect flow", () => {
  it("opens the Connect Gemini dialog on the first submit and does not generate", () => {
    renderApp();
    typeUrl();
    clickGenerate();

    expect(screen.getByRole("dialog", { name: "Connect Gemini" })).toBeInTheDocument();
    expect(generateReflection).not.toHaveBeenCalled();
    expect(screen.queryByText(WATCHING)).not.toBeInTheDocument();
    expect(trackEvent).toHaveBeenCalledWith("connect_open", { mode: "connect" });
  });

  it("shows the chip as not connected, then connected after a key is stored", async () => {
    renderApp();
    expect(screen.getByRole("button", { name: "Connect Gemini" })).toBeInTheDocument();

    validateKey.mockResolvedValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Connect Gemini" }));
    fireEvent.change(within(dialog()).getByLabelText("Paste your API key"), { target: { value: KEY } });
    fireEvent.click(within(dialog()).getByRole("button", { name: "Test and connect" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Gemini Flash connected/i })).toBeInTheDocument();
    expect(getKey()).toBe(KEY);
    expect(generateReflection).not.toHaveBeenCalled(); // nothing was pending
  });

  it("keeps the dialog open with an inline error when the key is rejected", async () => {
    validateKey.mockRejectedValue(
      Object.assign(new Error("That key didn't work. Check it in Google AI Studio and try again."), {
        type: "invalid_key",
        status: 400,
      }),
    );
    renderApp();
    typeUrl();
    clickGenerate();

    fireEvent.change(within(dialog()).getByLabelText("Paste your API key"), { target: { value: "bad" } });
    fireEvent.click(within(dialog()).getByRole("button", { name: "Test and connect" }));

    expect(await within(dialog()).findByRole("alert")).toHaveTextContent("That key didn't work");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(getKey()).toBe("");
    expect(generateReflection).not.toHaveBeenCalled();
    expect(trackEvent).toHaveBeenCalledWith("connect_error", expect.objectContaining({ error_type: "invalid_key" }));
  });

  it("requires a key before testing", async () => {
    renderApp();
    typeUrl();
    clickGenerate();
    fireEvent.click(within(dialog()).getByRole("button", { name: "Test and connect" }));

    expect(await within(dialog()).findByRole("alert")).toHaveTextContent("Paste your API key first.");
    expect(validateKey).not.toHaveBeenCalled();
  });

  it("connecting resumes the pending URL without a second click and remembers the key", async () => {
    validateKey.mockResolvedValue(true);
    mockArticle("My Title\n\nBody.");
    renderApp();
    typeUrl();
    clickGenerate();

    fireEvent.change(within(dialog()).getByLabelText("Paste your API key"), { target: { value: KEY } });
    fireEvent.click(within(dialog()).getByRole("button", { name: "Test and connect" }));

    expect(await screen.findByLabelText("Generated article")).toHaveTextContent("My Title");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(generateReflection).toHaveBeenCalledTimes(1);
    expect(generateReflection.mock.calls[0][0]).toMatchObject({ url: URL, key: KEY });
    expect(window.localStorage.getItem("sermon.gemini.key")).toBe(KEY);
    expect(trackEvent).toHaveBeenCalledWith("connect_success", { remember: true });
  });

  it("unchecking Remember stores the key for this session only", async () => {
    validateKey.mockResolvedValue(true);
    mockArticle("ok");
    renderApp();
    typeUrl();
    clickGenerate();

    fireEvent.change(within(dialog()).getByLabelText("Paste your API key"), { target: { value: KEY } });
    fireEvent.click(within(dialog()).getByLabelText("Remember on this device"));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Test and connect" }));

    await screen.findByLabelText("Generated article");
    expect(window.sessionStorage.getItem("sermon.gemini.key")).toBe(KEY);
    expect(window.localStorage.getItem("sermon.gemini.key")).toBeNull();
    expect(trackEvent).toHaveBeenCalledWith("connect_success", { remember: false });
  });

  it("Cancel closes the dialog, stores nothing, and drops the pending URL", async () => {
    validateKey.mockResolvedValue(true);
    mockArticle("ok");
    renderApp();
    typeUrl();
    clickGenerate();
    fireEvent.click(within(dialog()).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(getKey()).toBe("");

    // Connecting later from the chip must not generate the URL cancelled above.
    fireEvent.click(screen.getByRole("button", { name: "Connect Gemini" }));
    fireEvent.change(within(dialog()).getByLabelText("Paste your API key"), { target: { value: KEY } });
    fireEvent.click(within(dialog()).getByRole("button", { name: "Test and connect" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(generateReflection).not.toHaveBeenCalled();
  });

  it("Escape closes the dialog", () => {
    renderApp();
    typeUrl();
    clickGenerate();
    fireEvent.keyDown(dialog(), { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("the chip opens manage mode when connected, and Forget key disconnects", () => {
    connectKey();
    renderApp();
    fireEvent.click(screen.getByRole("button", { name: /Gemini Flash connected/i }));

    expect(screen.getByRole("dialog", { name: "Manage your Gemini key" })).toBeInTheDocument();
    expect(trackEvent).toHaveBeenCalledWith("connect_open", { mode: "manage" });
    fireEvent.click(within(dialog()).getByRole("button", { name: "Forget key" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(getKey()).toBe("");
    expect(screen.getByRole("button", { name: "Connect Gemini" })).toBeInTheDocument();
    expect(trackEvent).toHaveBeenCalledWith("key_forgotten");
  });

  it("a DEFINITIVE invalid_key failure mid-generation forgets the key and reopens the dialog with the message", async () => {
    connectKey();
    mockFailure("invalid_key", "That key didn't work. Check it in Google AI Studio and try again.", 400, { definitive: true });
    renderApp();
    typeUrl();
    clickGenerate();

    const dlg = await screen.findByRole("dialog", { name: "Connect Gemini" });
    expect(within(dlg).getByRole("alert")).toHaveTextContent("That key didn't work");
    expect(getKey()).toBe("");
    expect(screen.getByRole("button", { name: "Connect Gemini" })).toBeInTheDocument();

    // Connecting a new key retries the same URL.
    validateKey.mockResolvedValue(true);
    mockArticle("Retried.");
    fireEvent.change(within(dlg).getByLabelText("Paste your API key"), { target: { value: KEY } });
    fireEvent.click(within(dlg).getByRole("button", { name: "Test and connect" }));
    expect(await screen.findByLabelText("Generated article")).toHaveTextContent("Retried.");
    expect(generateReflection).toHaveBeenLastCalledWith(expect.objectContaining({ url: URL, key: KEY }));
  });

  it("a non-definitive invalid_key keeps the stored key and opens the manage dialog with the message", async () => {
    connectKey();
    mockFailure("invalid_key", "That key didn't work.", 403); // no `definitive`
    renderApp();
    typeUrl();
    clickGenerate();

    const dlg = await screen.findByRole("dialog", { name: "Manage your Gemini key" });
    expect(within(dlg).getByRole("alert")).toHaveTextContent("That key didn't work.");
    expect(getKey()).toBe(KEY);
    expect(window.localStorage.getItem("sermon.gemini.key")).toBe(KEY);
    expect(screen.getByRole("button", { name: /Gemini Flash connected/i })).toBeInTheDocument();
  });

  it("an unexplained 403 from the real classifier (access_denied) never touches the stored key", async () => {
    connectKey();
    const { classify } = await vi.importActual("./lib/gemini.js");
    const err = classify(403, { error: { code: 403, status: "PERMISSION_DENIED", message: "x", details: [{ reason: "SOME_NEW_REASON" }] } });
    expect(err.type).toBe("access_denied");
    generateReflection.mockRejectedValue(err);
    renderApp();
    typeUrl();
    clickGenerate();

    expect(await screen.findByRole("alert")).toHaveTextContent("Your key is still saved");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(getKey()).toBe(KEY);
  });

  it("updates the chip when another tab forgets or adds the key", () => {
    window.localStorage.setItem("sermon.gemini.key", KEY); // loaded from storage, not set in this tab
    renderApp();
    expect(screen.getByRole("button", { name: /connected/i })).toBeInTheDocument();
    act(() => {
      window.localStorage.removeItem("sermon.gemini.key");
      window.dispatchEvent(new StorageEvent("storage", { key: "sermon.gemini.key", newValue: null }));
    });
    expect(screen.getByRole("button", { name: "Connect Gemini" })).toBeInTheDocument();
    act(() => {
      window.localStorage.setItem("sermon.gemini.key", KEY);
      window.dispatchEvent(new StorageEvent("storage", { key: "sermon.gemini.key", newValue: KEY }));
    });
    expect(screen.getByRole("button", { name: /connected/i })).toBeInTheDocument();
  });

  it("puts focus on the URL field when a dialog that opened itself is dismissed", async () => {
    connectKey();
    mockFailure("invalid_key", "bad", 400, { definitive: true });
    renderApp();
    typeUrl();
    clickGenerate();
    await screen.findByRole("dialog");
    document.body.focus();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(screen.getByLabelText("YouTube URL"));
  });

  it("has a persistent, initially empty status region so announcements are not missed", () => {
    renderApp();
    expect(status()).toHaveTextContent("");
  });

  it("the show/hide toggle reveals the key field", () => {
    renderApp();
    typeUrl();
    clickGenerate();
    const input = within(dialog()).getByLabelText("Paste your API key");
    expect(input).toHaveAttribute("type", "password");
    fireEvent.click(within(dialog()).getByRole("button", { name: "Show key" }));
    expect(input).toHaveAttribute("type", "text");
    fireEvent.click(within(dialog()).getByRole("button", { name: "Hide key" }));
    expect(input).toHaveAttribute("type", "password");
  });

  it("never sends the key (or any part of it) to analytics", async () => {
    validateKey.mockResolvedValue(true);
    mockArticle("ok");
    renderApp();
    typeUrl();
    clickGenerate();
    fireEvent.change(within(dialog()).getByLabelText("Paste your API key"), { target: { value: KEY } });
    fireEvent.click(within(dialog()).getByRole("button", { name: "Test and connect" }));
    await screen.findByLabelText("Generated article");

    expect(trackEvent.mock.calls.length).toBeGreaterThan(3);
    for (const call of trackEvent.mock.calls) {
      const serialized = JSON.stringify(call);
      expect(serialized).not.toContain(KEY);
      expect(serialized).not.toContain(KEY.slice(0, 12));
    }
  });
});

describe("Copy button", () => {
  const ARTICLE = "My Title\n\nThe full article body.";

  function mockClipboard(writeText) {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
      writable: true,
    });
  }

  async function renderWithArticle() {
    connectKey();
    mockArticle(ARTICLE);
    renderApp();
    fireEvent.change(screen.getByLabelText("YouTube URL"), {
      target: { value: "https://youtu.be/dQw4w9WgXcQ" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate Article" }));
    await screen.findByLabelText("Generated article");
  }

  it("is not shown before an article exists, and appears after", async () => {
    renderApp();
    expect(screen.queryByRole("button", { name: /copy text/i })).not.toBeInTheDocument();
    // (cleanup of this render happens in afterEach)
  });

  it("copies the full article text and shows 'Copied!'", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    mockClipboard(writeText);
    await renderWithArticle();

    fireEvent.click(screen.getByRole("button", { name: /copy text/i }));

    expect(await screen.findByRole("button", { name: /copied/i })).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(ARTICLE);
    // Screen-reader announcement (aria-live region).
    expect(screen.getByText("Article copied to clipboard")).toBeInTheDocument();
  });

  it("reverts to 'Copy Text' after 2 seconds", async () => {
    mockClipboard(vi.fn().mockResolvedValue(undefined));
    await renderWithArticle();

    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole("button", { name: /copy text/i }));
      await act(async () => {}); // flush the writeText resolution → setCopied(true)
      expect(screen.getByRole("button", { name: /copied/i })).toBeInTheDocument();

      act(() => vi.advanceTimersByTime(2000));
      expect(screen.getByRole("button", { name: /copy text/i })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows a friendly error if clipboard write fails", async () => {
    mockClipboard(vi.fn().mockRejectedValue(new Error("denied")));
    await renderWithArticle();

    fireEvent.click(screen.getByRole("button", { name: /copy text/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("copy");
    // The article is still there to copy manually.
    expect(screen.getByLabelText("Generated article")).toBeInTheDocument();
  });

  it("resets the 2s window on a rapid re-copy", async () => {
    mockClipboard(vi.fn().mockResolvedValue(undefined));
    await renderWithArticle();

    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole("button", { name: /copy text/i }));
      await act(async () => {});
      expect(screen.getByRole("button", { name: /copied/i })).toBeInTheDocument();

      act(() => vi.advanceTimersByTime(1500)); // first window not yet elapsed
      fireEvent.click(screen.getByRole("button", { name: /copied/i })); // re-copy resets it
      await act(async () => {});

      act(() => vi.advanceTimersByTime(1500)); // 1.5s since the reset (< 2s)
      expect(screen.getByRole("button", { name: /copied/i })).toBeInTheDocument();

      act(() => vi.advanceTimersByTime(600)); // now past 2s since the reset
      expect(screen.getByRole("button", { name: /copy text/i })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears a prior 'Copied!' when a new article is generated", async () => {
    mockClipboard(vi.fn().mockResolvedValue(undefined));
    await renderWithArticle();

    fireEvent.click(screen.getByRole("button", { name: /copy text/i }));
    await screen.findByRole("button", { name: /copied/i });

    // Generate again (the mocked client returns an article on every call).
    fireEvent.click(screen.getByRole("button", { name: "Generate Article" }));
    await screen.findByLabelText("Generated article");

    expect(screen.getByRole("button", { name: /copy text/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /copied/i })).not.toBeInTheDocument();
  });
});

describe("Result meta (word count + reading time)", () => {
  async function renderWithArticle(article) {
    connectKey();
    mockArticle(article);
    renderApp();
    typeUrl();
    clickGenerate();
    await screen.findByLabelText("Generated article");
  }

  it("counts words and floors the reading time at 1 minute for a short article", async () => {
    // 5 words → round(5/200) = 0, floored to a 1 min read.
    await renderWithArticle("My Title\n\nA fine article.");
    expect(screen.getByText("5 words · 1 min read")).toBeInTheDocument();
  });

  it("rounds reading time to ~200 words per minute for a longer article", async () => {
    // 400 single-token words → round(400/200) = 2 min read.
    await renderWithArticle(Array(400).fill("word").join(" "));
    expect(screen.getByText("400 words · 2 min read")).toBeInTheDocument();
  });
});

describe("Tagline and trust line", () => {
  it("renders the tagline without the captions requirement", () => {
    renderApp();
    expect(
      screen.getByText(/Paste a YouTube sermon link and get a clean, ready-to-publish article/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/captioned/i)).not.toBeInTheDocument();
  });

  it("states the privacy promise exactly as analytics behaves: key stays with Google, video id is logged", () => {
    renderApp();
    const line = screen.getByText(/never leaves your browser except to Google/i);
    expect(line).toHaveTextContent("We log which video was summarized, never the article or your key.");
    expect(screen.queryByText(/video never touch/i)).not.toBeInTheDocument();
  });
});


describe("Top nav", () => {
  it("renders the text logo and the nav links in the correct order", () => {
    renderApp();
    expect(screen.getByRole("link", { name: /Sermon Summarizer home/i })).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Primary" });
    const aboutBtn = within(nav).getByRole("link", { name: /About/i });
    const contactLink = within(nav).getByRole("link", { name: /Contact/i });

    expect(aboutBtn).toBeInTheDocument();
    expect(contactLink).toBeInTheDocument();
    expect(aboutBtn.compareDocumentPosition(contactLink)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("links Contact to the /contact page", () => {
    renderApp();
    const nav = screen.getByRole("navigation", { name: "Primary" });
    const contact = within(nav).getByRole("link", { name: "Contact" });
    expect(contact.getAttribute("href")).toBe("/contact");
  });
});

describe("About page", () => {
  it("navigates to About page on clicking About button, hides the main form, and displays About content", () => {
    renderApp();

    expect(screen.getByRole("heading", { name: "Sermon Summarizer" })).toBeInTheDocument();
    expect(screen.getByLabelText("YouTube URL")).toBeInTheDocument();

    const aboutBtn = screen.getByRole("link", { name: /About/i });
    fireEvent.click(aboutBtn);

    expect(screen.queryByRole("heading", { name: "Sermon Summarizer" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("YouTube URL")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "About Sermon Summarizer" })).toBeInTheDocument();
    expect(screen.getByText(/How it stays free/i)).toBeInTheDocument();
  });

  it("navigates back to home on clicking logo", () => {
    renderApp();

    fireEvent.click(screen.getByRole("link", { name: /About/i }));
    expect(screen.getByRole("heading", { name: "About Sermon Summarizer" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: /Sermon Summarizer home/i }));
    expect(screen.getByRole("heading", { name: "Sermon Summarizer" })).toBeInTheDocument();
  });
});

describe("Footer", () => {
  it("renders the footer with copyright and creator credit", () => {
    renderApp();
    const footer = screen.getByRole("contentinfo");
    expect(within(footer).getByText(/© 2026 Sermon Summarizer. All rights reserved./i)).toBeInTheDocument();
    expect(within(footer).getByText(/Made by/i)).toBeInTheDocument();
    const link = within(footer).getByRole("link", { name: /Ife Adese/i });
    expect(link).toBeInTheDocument();
    expect(link.getAttribute("href")).toBe("https://ifeadese.com");
  });
});

describe("Analytics events", () => {
  it("tracks a page_view for the current route on render", () => {
    renderApp(["/"]);
    expect(trackPageView).toHaveBeenCalledWith("/");
  });

  it("tracks a page_view on SPA route change", () => {
    renderApp(["/"]);
    fireEvent.click(screen.getByRole("link", { name: /About/i }));
    expect(trackPageView).toHaveBeenCalledWith("/about");
  });

  it("tracks generate_submit and generate_success with provider + model on a successful generation", async () => {
    connectKey();
    mockArticle("My Title\n\nA fine article.");
    renderApp();
    typeUrl();
    clickGenerate();
    await screen.findByLabelText("Generated article");

    expect(trackEvent).toHaveBeenCalledWith("generate_submit", {
      video_id: "dQw4w9WgXcQ",
      provider: "gemini",
      model: "gemini-test-model",
    });
    expect(trackEvent).toHaveBeenCalledWith(
      "generate_success",
      expect.objectContaining({ video_id: "dQw4w9WgXcQ", word_count: 5, provider: "gemini", model: "gemini-test-model" }),
    );
  });

  it("records the video id on generate_* events only, and never the article text", async () => {
    // This is the disclosure on the page: "We log which video was summarized,
    // never the article or your key." Keep the two in step.
    const ARTICLE = "My Title\n\nA fine article with a distinctive-phrase-xyz.";
    connectKey();
    mockArticle(ARTICLE);
    renderApp();
    typeUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30s");
    clickGenerate();
    await screen.findByLabelText("Generated article");
    mockFailure("network", "Could not reach Gemini.");
    clickGenerate();
    await screen.findByRole("alert");

    const withId = trackEvent.mock.calls.filter((call) => JSON.stringify(call).includes("dQw4w9WgXcQ")).map(([name]) => name);
    expect(new Set(withId)).toEqual(new Set(["generate_submit", "generate_success", "generate_error"]));
    for (const call of trackEvent.mock.calls) {
      const serialized = JSON.stringify(call);
      expect(serialized).not.toContain("distinctive-phrase-xyz"); // never the article
      expect(serialized).not.toContain("t=30s"); // the id, not the raw link the user pasted
      expect(serialized).not.toContain(KEY);
    }
  });

  it("tracks generate_error with a useful error_type on failure", async () => {
    connectKey();
    mockFailure("network", "Could not reach Gemini.");
    renderApp();
    typeUrl();
    clickGenerate();
    await screen.findByRole("alert");

    expect(trackEvent).toHaveBeenCalledWith(
      "generate_error",
      expect.objectContaining({ error_type: "network", provider: "gemini" }),
    );
  });

  it("tracks copy_article when the article is copied", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
      writable: true,
    });
    connectKey();
    mockArticle("T\n\nBody.");
    renderApp();
    typeUrl();
    clickGenerate();
    await screen.findByLabelText("Generated article");

    fireEvent.click(screen.getByRole("button", { name: /copy text/i }));
    await screen.findByRole("button", { name: /copied/i });

    expect(trackEvent).toHaveBeenCalledWith("copy_article", { success: true });
  });
});
