import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import App from "./App.jsx";

const URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

function typeUrl(value = URL) {
  fireEvent.change(screen.getByLabelText("YouTube URL"), { target: { value } });
}

afterEach(() => {
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
    fireEvent.click(screen.getByRole("button", { name: "Generate Article" }));

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
    fireEvent.click(screen.getByRole("button", { name: "Generate Article" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("No transcript available for this video.");
  });

  it("shows a reachability message when the request fails at the network level", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    render(<App />);
    typeUrl();
    fireEvent.click(screen.getByRole("button", { name: "Generate Article" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Could not reach the server");
  });

  it("disables the button and shows a status while the request is in flight", async () => {
    let resolveFetch;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockReturnValue(new Promise((resolve) => { resolveFetch = resolve; })),
    );
    render(<App />);
    typeUrl();
    fireEvent.click(screen.getByRole("button", { name: "Generate Article" }));

    // While pending: status shown, button disabled.
    expect(await screen.findByRole("status")).toBeInTheDocument();
    expect(screen.getByRole("button")).toBeDisabled();

    // Resolve to finish the in-flight request cleanly.
    resolveFetch({ ok: true, json: async () => ({ article: "done" }) });
    await waitFor(() =>
      expect(screen.getByLabelText("Generated article")).toBeInTheDocument(),
    );
  });
});
