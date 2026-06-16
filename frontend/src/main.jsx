import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

// Self-hosted fonts (Warm Sanctuary theme) — bundled with the app so there are
// no third-party requests, and they work offline / under a strict CSP.
import "@fontsource-variable/fraunces";
import "@fontsource-variable/inter";

import App from "./App.jsx";
import "./index.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
