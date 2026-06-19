import { render, screen, fireEvent, act, within } from "@testing-library/react";

import { MemoryRouter } from "react-router-dom";
import App from "./App.jsx";

const URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

function typeUrl(value = URL) {
  fireEvent.change(screen.getByLabelText("YouTube URL"), { target: { value } });
}

function clickGenerate() {
  fireEvent.click(screen.getByRole("button", { name: "Generate Article" }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("App", () => {
  it("renders the app heading (the #8 acceptance criterion)", () => {
    render(<MemoryRouter><App /></MemoryRouter>);
    expect(
      screen.getByRole("heading", { name: "sermon summarizer" }),
    ).toBeInTheDocument();
  });

  it("disables the button until a valid YouTube URL is entered", () => {
    render(<MemoryRouter><App /></MemoryRouter>);
    const button = screen.getByRole("button", { name: "Generate Article" });
    expect(button).toBeDisabled();
    typeUrl("https://example.com/not-youtube");
    expect(button).toBeDisabled();
    typeUrl("not-a-url");
    expect(button).toBeDisabled();
    typeUrl();
    expect(button).toBeEnabled();
  });

  it("shows the article returned by the backend on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ article: "My Title\n\nA fine article." }),
      }),
    );
    render(<MemoryRouter><App /></MemoryRouter>);
    typeUrl();
    clickGenerate();

    const article = await screen.findByLabelText("Generated article");
    expect(article).toHaveTextContent("My Title");
    expect(article).toHaveTextContent("A fine article.");
  });

  it("shows a friendly message when the backend returns an error detail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ detail: "No transcript available for this video." }),
      }),
    );
    render(<MemoryRouter><App /></MemoryRouter>);
    typeUrl();
    clickGenerate();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No transcript available for this video.",
    );
  });

  it("shows a reachability message when the request fails at the network level", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    render(<MemoryRouter><App /></MemoryRouter>);
    typeUrl();
    clickGenerate();

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the server");
  });

  it("shows a timeout message when the request is aborted", async () => {
    const abortErr = Object.assign(new Error("aborted"), { name: "AbortError" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abortErr));
    render(<MemoryRouter><App /></MemoryRouter>);
    typeUrl();
    clickGenerate();

    expect(await screen.findByRole("alert")).toHaveTextContent("took too long");
  });

  it("shows a friendly message on a malformed success body (invalid JSON)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => {
          throw new SyntaxError("Unexpected token < in JSON");
        },
      }),
    );
    render(<MemoryRouter><App /></MemoryRouter>);
    typeUrl();
    clickGenerate();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("unexpected response");
    expect(alert).not.toHaveTextContent("Unexpected token"); // no raw parser error leaked
  });

  it("shows a friendly message when a 200 has a missing/non-string article", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ article: { not: "a string" } }),
      }),
    );
    render(<MemoryRouter><App /></MemoryRouter>);
    typeUrl();
    clickGenerate();

    expect(await screen.findByRole("alert")).toHaveTextContent("empty article");
    // The bad payload must never reach the DOM as a rendered child.
    expect(screen.queryByLabelText("Generated article")).not.toBeInTheDocument();
  });

  it("trims the URL before sending it to the backend", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ article: "ok" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<MemoryRouter><App /></MemoryRouter>);
    typeUrl(`   ${URL}   `);
    clickGenerate();

    await screen.findByLabelText("Generated article");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.url).toBe(URL);
  });

  it("ignores a rapid second submit while one request is in flight", async () => {
    let resolveFetch;
    const fetchMock = vi
      .fn()
      .mockReturnValue(new Promise((resolve) => { resolveFetch = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    render(<MemoryRouter><App /></MemoryRouter>);
    typeUrl();

    const form = screen.getByLabelText("YouTube URL").closest("form");
    fireEvent.submit(form);
    fireEvent.submit(form); // second submit before the first resolves

    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch({ ok: true, json: async () => ({ article: "done" }) });
    await screen.findByLabelText("Generated article");
  });

  it("shows a status and disables the button while in flight, then clears on completion", async () => {
    let resolveFetch;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockReturnValue(new Promise((resolve) => { resolveFetch = resolve; })),
    );
    render(<MemoryRouter><App /></MemoryRouter>);
    typeUrl();
    clickGenerate();

    expect(await screen.findByRole("status")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /generat/i })).toBeDisabled();

    resolveFetch({ ok: true, json: async () => ({ article: "done" }) });

    await screen.findByLabelText("Generated article");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    // After completion both Generate and Copy buttons exist — target Generate.
    expect(screen.getByRole("button", { name: "Generate Article" })).toBeEnabled();
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
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ article: ARTICLE }) }),
    );
    render(<MemoryRouter><App /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText("YouTube URL"), {
      target: { value: "https://youtu.be/dQw4w9WgXcQ" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate Article" }));
    await screen.findByLabelText("Generated article");
  }

  it("is not shown before an article exists, and appears after", async () => {
    render(<MemoryRouter><App /></MemoryRouter>);
    expect(screen.queryByRole("button", { name: /copy article/i })).not.toBeInTheDocument();
    // (cleanup of this render happens in afterEach)
  });

  it("copies the full article text and shows 'Copied!'", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    mockClipboard(writeText);
    await renderWithArticle();

    fireEvent.click(screen.getByRole("button", { name: "Copy Article" }));

    expect(await screen.findByRole("button", { name: "Copied!" })).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(ARTICLE);
    // Screen-reader announcement (aria-live region).
    expect(screen.getByText("Article copied to clipboard")).toBeInTheDocument();
  });

  it("reverts to 'Copy Article' after 2 seconds", async () => {
    mockClipboard(vi.fn().mockResolvedValue(undefined));
    await renderWithArticle();

    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole("button", { name: "Copy Article" }));
      await act(async () => {}); // flush the writeText resolution → setCopied(true)
      expect(screen.getByRole("button", { name: "Copied!" })).toBeInTheDocument();

      act(() => vi.advanceTimersByTime(2000));
      expect(screen.getByRole("button", { name: "Copy Article" })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows a friendly error if clipboard write fails", async () => {
    mockClipboard(vi.fn().mockRejectedValue(new Error("denied")));
    await renderWithArticle();

    fireEvent.click(screen.getByRole("button", { name: "Copy Article" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("copy");
    // The article is still there to copy manually.
    expect(screen.getByLabelText("Generated article")).toBeInTheDocument();
  });

  it("resets the 2s window on a rapid re-copy", async () => {
    mockClipboard(vi.fn().mockResolvedValue(undefined));
    await renderWithArticle();

    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole("button", { name: "Copy Article" }));
      await act(async () => {});
      expect(screen.getByRole("button", { name: "Copied!" })).toBeInTheDocument();

      act(() => vi.advanceTimersByTime(1500)); // first window not yet elapsed
      fireEvent.click(screen.getByRole("button", { name: "Copied!" })); // re-copy resets it
      await act(async () => {});

      act(() => vi.advanceTimersByTime(1500)); // 1.5s since the reset (< 2s)
      expect(screen.getByRole("button", { name: "Copied!" })).toBeInTheDocument();

      act(() => vi.advanceTimersByTime(600)); // now past 2s since the reset
      expect(screen.getByRole("button", { name: "Copy Article" })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears a prior 'Copied!' when a new article is generated", async () => {
    mockClipboard(vi.fn().mockResolvedValue(undefined));
    await renderWithArticle();

    fireEvent.click(screen.getByRole("button", { name: "Copy Article" }));
    await screen.findByRole("button", { name: "Copied!" });

    // Generate again (the stubbed fetch returns an article on every call).
    fireEvent.click(screen.getByRole("button", { name: "Generate Article" }));
    await screen.findByLabelText("Generated article");

    expect(screen.getByRole("button", { name: "Copy Article" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copied!" })).not.toBeInTheDocument();
  });
});

describe("Result meta (word count + reading time)", () => {
  async function renderWithArticle(article) {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ article }) }),
    );
    render(<MemoryRouter><App /></MemoryRouter>);
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

describe("Tagline", () => {
  it("renders the consolidated tagline", () => {
    render(<MemoryRouter><App /></MemoryRouter>);
    expect(
      screen.getByText(/Paste a captioned YouTube sermon link and get a clean, ready-to-publish article/i),
    ).toBeInTheDocument();
  });
});


describe("Top nav", () => {
  it("renders the text logo and the nav links in the correct order", () => {
    render(<MemoryRouter><App /></MemoryRouter>);
    expect(screen.getByRole("link", { name: /Sermon Summarizer home/i })).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Primary" });
    const aboutBtn = within(nav).getByRole("link", { name: /About/i });
    const contactLink = within(nav).getByRole("link", { name: /Contact/i });
    
    expect(aboutBtn).toBeInTheDocument();
    expect(contactLink).toBeInTheDocument();
    expect(aboutBtn.compareDocumentPosition(contactLink)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("makes Contact a mailto link", () => {
    render(<MemoryRouter><App /></MemoryRouter>);
    const nav = screen.getByRole("navigation", { name: "Primary" });
    const contact = within(nav).getByRole("link", { name: "Contact" });
    expect(contact.getAttribute("href")).toMatch(/^mailto:/);
  });
});

describe("About page", () => {
  it("navigates to About page on clicking About button, hides the main form, and displays About content", () => {
    render(<MemoryRouter><App /></MemoryRouter>);
    
    expect(screen.getByRole("heading", { name: "sermon summarizer" })).toBeInTheDocument();
    expect(screen.getByLabelText("YouTube URL")).toBeInTheDocument();
    
    const aboutBtn = screen.getByRole("link", { name: /About/i });
    fireEvent.click(aboutBtn);
    
    expect(screen.queryByRole("heading", { name: "sermon summarizer" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("YouTube URL")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "About Sermon Summarizer" })).toBeInTheDocument();
  });

  it("navigates back to home on clicking logo", () => {
    render(<MemoryRouter><App /></MemoryRouter>);
    
    fireEvent.click(screen.getByRole("link", { name: /About/i }));
    expect(screen.getByRole("heading", { name: "About Sermon Summarizer" })).toBeInTheDocument();
    
    fireEvent.click(screen.getByRole("link", { name: /Sermon Summarizer home/i }));
    expect(screen.getByRole("heading", { name: "sermon summarizer" })).toBeInTheDocument();
  });
});

describe("Footer", () => {
  it("renders the footer with copyright and creator credit", () => {
    render(<MemoryRouter><App /></MemoryRouter>);
    const footer = screen.getByRole("contentinfo");
    expect(within(footer).getByText(/© 2026 Sermon Summarizer. All rights reserved./i)).toBeInTheDocument();
    expect(within(footer).getByText(/Made by/i)).toBeInTheDocument();
    const link = within(footer).getByRole("link", { name: /Ife Adese/i });
    expect(link).toBeInTheDocument();
    expect(link.getAttribute("href")).toBe("https://ifeadese.com");
  });
});
