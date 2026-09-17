import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import ConnectGeminiModal from "./ConnectGeminiModal.jsx";
import { validateKey } from "./lib/gemini.js";

vi.mock("./analytics.js", () => ({
  trackEvent: vi.fn(),
}));

vi.mock("./lib/gemini.js", async (importOriginal) => ({
  ...(await importOriginal()), // real cleanPastedKey and URL constants
  validateKey: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

function renderModal(props = {}) {
  const handlers = { onConnected: vi.fn(), onForget: vi.fn(), onClose: vi.fn() };
  const utils = render(<ConnectGeminiModal open mode="connect" {...handlers} {...props} />);
  return { ...utils, ...handlers };
}

describe("ConnectGeminiModal", () => {
  it("renders nothing when closed", () => {
    render(<ConnectGeminiModal open={false} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("is a labelled modal dialog with the AI Studio link opening in a new tab", () => {
    renderModal();
    const dialog = screen.getByRole("dialog", { name: "Connect Gemini" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    const link = screen.getByRole("link", { name: /Google AI Studio/i });
    expect(link).toHaveAttribute("href", "https://aistudio.google.com/apikey");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("focuses the key field on open", () => {
    renderModal();
    expect(screen.getByLabelText("Paste your API key")).toHaveFocus();
  });

  it("shows an initial error passed in (e.g. after a stored key stopped working)", () => {
    renderModal({ initialError: "That key didn't work." });
    expect(screen.getByRole("alert")).toHaveTextContent("That key didn't work.");
  });

  it("clears the error once the user edits the field", () => {
    renderModal({ initialError: "That key didn't work." });
    fireEvent.change(screen.getByLabelText("Paste your API key"), { target: { value: "x" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("validates then reports the trimmed key and the remember choice", async () => {
    validateKey.mockResolvedValue(true);
    const { onConnected } = renderModal();
    fireEvent.change(screen.getByLabelText("Paste your API key"), { target: { value: "  AIzaTEST  " } });
    fireEvent.click(screen.getByRole("button", { name: "Test and connect" }));

    await waitFor(() => expect(onConnected).toHaveBeenCalledWith("AIzaTEST", { remember: true }));
    expect(validateKey.mock.calls[0][0]).toBe("AIzaTEST");
  });

  it("disables the field and submit while validating, but never Cancel", async () => {
    let finish;
    validateKey.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const { onConnected } = renderModal();
    fireEvent.change(screen.getByLabelText("Paste your API key"), { target: { value: "AIzaTEST" } });
    fireEvent.click(screen.getByRole("button", { name: "Test and connect" }));

    expect(await screen.findByRole("button", { name: "Testing…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
    expect(screen.getByLabelText("Paste your API key")).toBeDisabled();

    finish(true);
    await waitFor(() => expect(onConnected).toHaveBeenCalled());
  });

  it("passes an AbortSignal to validateKey, and Cancel/Escape abort a hung test and close", async () => {
    validateKey.mockImplementation(() => new Promise(() => {})); // hangs
    const { onClose, unmount } = renderModal();
    fireEvent.change(screen.getByLabelText("Paste your API key"), { target: { value: "AIzaTEST" } });
    fireEvent.click(screen.getByRole("button", { name: "Test and connect" }));
    await screen.findByRole("button", { name: "Testing…" });

    const signal = validateKey.mock.calls[0][1]?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount(); // the parent closes it; unmount aborts the test in flight
    expect(signal.aborted).toBe(true);
  });

  it("stays quiet when the test is cancelled by closing (no error flashes on an unmounting dialog)", async () => {
    validateKey.mockImplementation((_k, { signal }) => new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(Object.assign(new Error("Generation cancelled."), { type: "cancelled" })));
    }));
    const { unmount } = renderModal();
    fireEvent.change(screen.getByLabelText("Paste your API key"), { target: { value: "AIzaTEST" } });
    fireEvent.click(screen.getByRole("button", { name: "Test and connect" }));
    await screen.findByRole("button", { name: "Testing…" });
    unmount();
    await waitFor(() => expect(validateKey).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("closes on Escape even when focus has left the dialog", () => {
    const { onClose } = renderModal();
    document.body.focus();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("returns focus to the key field after a failed test", async () => {
    validateKey.mockRejectedValue(Object.assign(new Error("That key didn't work."), { type: "invalid_key" }));
    renderModal();
    const input = screen.getByLabelText("Paste your API key");
    fireEvent.change(input, { target: { value: "bad" } });
    fireEvent.click(screen.getByRole("button", { name: "Test and connect" }));

    await screen.findByRole("alert");
    await waitFor(() => expect(input).toHaveFocus());
    expect(input).toBeEnabled();
  });

  it("pulls a stray Tab back into the dialog", () => {
    renderModal();
    screen.getByLabelText("Paste your API key").blur(); // focus falls to <body>
    expect(document.activeElement).toBe(document.body);
    fireEvent.keyDown(document.body, { key: "Tab" });
    expect(screen.getByRole("link", { name: /Google AI Studio/i })).toHaveFocus();
  });

  it("closes on backdrop click but not on a click inside the dialog", () => {
    const { onClose } = renderModal();
    fireEvent.mouseDown(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(screen.getByRole("dialog").parentElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("wraps Tab focus inside the dialog", () => {
    renderModal();
    const dialog = screen.getByRole("dialog");
    const first = screen.getByRole("link", { name: /Google AI Studio/i });
    const last = screen.getByRole("link", { name: /Gemini API terms/i });

    last.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(first).toHaveFocus();

    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();
  });

  it.each([
    ['"AIzaTESTKEY000"', "double quotes"],
    ["GEMINI_API_KEY=AIzaTESTKEY000", "a .env line"],
    ["export GOOGLE_API_KEY='AIzaTESTKEY000'", "an export line"],
  ])("cleans %s (%s) before testing", async (pasted) => {
    validateKey.mockResolvedValue(true);
    const { onConnected } = renderModal();
    fireEvent.change(screen.getByLabelText("Paste your API key"), { target: { value: pasted } });
    fireEvent.click(screen.getByRole("button", { name: "Test and connect" }));
    await waitFor(() => expect(validateKey).toHaveBeenCalled());
    expect(validateKey.mock.calls[0][0]).toBe("AIzaTESTKEY000");
    await waitFor(() => expect(onConnected).toHaveBeenCalledWith("AIzaTESTKEY000", { remember: true }));
  });

  it("hints, without blocking, when the key does not look like an AI Studio key", async () => {
    renderModal();
    fireEvent.change(screen.getByLabelText("Paste your API key"), { target: { value: "AQ.some-other-format" } });
    expect(screen.getByText(/usually start with AIza/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Paste your API key"), { target: { value: "AIzaTEST" } });
    expect(screen.queryByText(/usually start with AIza/)).not.toBeInTheDocument();
  });

  it("discloses Google's terms: free-tier data use, 18+, Europe billing, with a link", () => {
    renderModal();
    const foot = screen.getByText(/Google may use what you send/);
    expect(foot).toHaveTextContent("18 or older");
    expect(foot).toHaveTextContent("EEA, UK or Switzerland");
    const link = screen.getByRole("link", { name: /Gemini API terms/i });
    expect(link).toHaveAttribute("href", "https://ai.google.dev/gemini-api/terms");
    expect(link).toHaveAttribute("target", "_blank");
    expect(screen.getByText(/Make one just for this site/)).toBeInTheDocument();
    expect(screen.getByText(/up to 20 requests and 8 hours of video a day/)).toBeInTheDocument();
  });

  it("describes itself, makes the app root inert while open, and restores it on close", () => {
    const root = document.createElement("div");
    root.id = "root";
    document.body.appendChild(root);
    try {
      const { unmount } = renderModal();
      const dialog = screen.getByRole("dialog");
      expect(dialog).toHaveAttribute("aria-describedby", "connect-lead");
      expect(document.getElementById("connect-lead")).toHaveTextContent(/Takes about a minute/);
      expect(root.inert).toBe(true);
      unmount();
      expect(root.inert).toBe(false);
    } finally {
      root.remove();
    }
  });

  it("falls back to the URL field when the opener was <body>", () => {
    const fallback = document.createElement("input");
    fallback.setAttribute("data-focus-fallback", "");
    document.body.appendChild(fallback);
    try {
      document.body.focus();
      const { unmount } = renderModal();
      unmount();
      expect(document.activeElement).toBe(fallback);
    } finally {
      fallback.remove();
    }
  });

  it("manage mode offers Forget key and a replace action", () => {
    const { onForget } = renderModal({ mode: "manage" });
    expect(screen.getByRole("dialog", { name: "Manage your Gemini key" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Test and replace" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Forget key" }));
    expect(onForget).toHaveBeenCalledTimes(1);
  });

  it("connect mode has no Forget key button", () => {
    renderModal();
    expect(screen.queryByRole("button", { name: "Forget key" })).not.toBeInTheDocument();
  });
});
