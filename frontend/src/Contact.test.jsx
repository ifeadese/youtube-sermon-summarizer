import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import Contact from "./Contact.jsx";
import { trackEvent } from "./analytics.js";

vi.mock("./analytics.js", () => ({
  trackEvent: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderContact() {
  // Contact uses <Link>, so it needs a router context.
  render(
    <MemoryRouter>
      <Contact />
    </MemoryRouter>,
  );
}

function fillForm() {
  fireEvent.change(screen.getByLabelText(/Name/i), { target: { value: "Jane Doe" } });
  fireEvent.change(screen.getByLabelText(/Email/i), { target: { value: "jane@example.com" } });
  fireEvent.change(screen.getByLabelText(/Subject/i), { target: { value: "Hello" } });
  fireEvent.change(screen.getByLabelText(/Message/i), { target: { value: "Just saying hi." } });
}

describe("Contact page", () => {
  it("renders the form fields and submit button", () => {
    renderContact();
    expect(screen.getByRole("heading", { name: "Contact" })).toBeInTheDocument();
    expect(screen.getByLabelText(/Name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Subject/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Message/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Send Message/i })).toBeInTheDocument();
  });

  it("asks for confirmation on first click instead of submitting", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderContact();
    fillForm();

    fireEvent.click(screen.getByRole("button", { name: /Send Message/i }));

    // Enters a confirm state and does NOT submit yet.
    expect(screen.getByRole("button", { name: /Confirm Send/i })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("submits to FormBold and shows the success state", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    renderContact();
    fillForm();

    fireEvent.submit(screen.getByRole("button", { name: /Send Message/i }).closest("form"));

    expect(await screen.findByText("Message Sent!")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Posts JSON to the configured FormBold endpoint.
    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body)).toMatchObject({ name: "Jane Doe", email: "jane@example.com" });
    // Analytics: submit + success.
    expect(trackEvent).toHaveBeenCalledWith("contact_submit");
    expect(trackEvent).toHaveBeenCalledWith("contact_success");
  });

  it("shows an error message when submission fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, headers: { get: () => "" } }));
    renderContact();
    fillForm();

    fireEvent.submit(screen.getByRole("button", { name: /Send Message/i }).closest("form"));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(trackEvent).toHaveBeenCalledWith("contact_error", expect.objectContaining({
      error_type: "submit_failed",
    }));
  });
});
