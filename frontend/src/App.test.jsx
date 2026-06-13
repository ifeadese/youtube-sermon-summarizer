import { render, screen, fireEvent } from "@testing-library/react";

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
    render(<App />);
    expect(
      screen.getByRole("heading", { name: "YouTube Sermon Summarizer" }),
    ).toBeInTheDocument();
  });

  it("disables the button until a URL is entered", () => {
    render(<App />);
    const button = screen.getByRole("button", { name: "Generate Article" });
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
    render(<App />);
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
    render(<App />);
    typeUrl();
    clickGenerate();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No transcript available for this video.",
    );
  });

  it("shows a reachability message when the request fails at the network level", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    render(<App />);
    typeUrl();
    clickGenerate();

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the server");
  });

  it("shows a timeout message when the request is aborted", async () => {
    const abortErr = Object.assign(new Error("aborted"), { name: "AbortError" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abortErr));
    render(<App />);
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
    render(<App />);
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
    render(<App />);
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
    render(<App />);
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
    render(<App />);
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
    render(<App />);
    typeUrl();
    clickGenerate();

    expect(await screen.findByRole("status")).toBeInTheDocument();
    expect(screen.getByRole("button")).toBeDisabled();

    resolveFetch({ ok: true, json: async () => ({ article: "done" }) });

    await screen.findByLabelText("Generated article");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("button")).toBeEnabled();
  });
});
