import { render, screen } from "@testing-library/react";

import App from "./App.jsx";

describe("App", () => {
  it("renders the app heading (the #8 acceptance criterion)", () => {
    render(<App />);
    expect(
      screen.getByRole("heading", { name: "YouTube Sermon Summarizer" }),
    ).toBeInTheDocument();
  });
});
