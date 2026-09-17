import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import ConnectGeminiModal from "./ConnectGeminiModal.jsx";
import { validateKey } from "./lib/gemini.js";

vi.mock("./analytics.js", () => ({
  trackEvent: vi.fn(),
}));

vi.mock("./lib/gemini.js", () => ({
  validateKey: vi.fn(),
  MODEL_LABEL: "Gemini Flash",
  AI_STUDIO_KEY_URL: "https://aistudio.google.com/apikey",
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
    expect(validateKey).toHaveBeenCalledWith("AIzaTEST");
  });

  it("disables the controls and shows Testing… while validating", async () => {
    let finish;
    validateKey.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const { onConnected } = renderModal();
    fireEvent.change(screen.getByLabelText("Paste your API key"), { target: { value: "AIzaTEST" } });
    fireEvent.click(screen.getByRole("button", { name: "Test and connect" }));

    expect(await screen.findByRole("button", { name: "Testing…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByLabelText("Paste your API key")).toBeDisabled();

    finish(true);
    await waitFor(() => expect(onConnected).toHaveBeenCalled());
  });

  it("does not close on Escape or backdrop click while validating", async () => {
    validateKey.mockReturnValue(new Promise(() => {}));
    const { onClose } = renderModal();
    fireEvent.change(screen.getByLabelText("Paste your API key"), { target: { value: "AIzaTEST" } });
    fireEvent.click(screen.getByRole("button", { name: "Test and connect" }));
    await screen.findByRole("button", { name: "Testing…" });

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    fireEvent.mouseDown(screen.getByRole("dialog").parentElement);
    expect(onClose).not.toHaveBeenCalled();
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
    const link = screen.getByRole("link", { name: /Google AI Studio/i });
    const submit = screen.getByRole("button", { name: "Test and connect" });

    submit.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(link).toHaveFocus();

    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(submit).toHaveFocus();
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
