import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, ExternalLink, Eye, EyeOff } from "lucide-react";

import { AI_STUDIO_KEY_URL, GEMINI_TERMS_URL, MODEL_LABEL, cleanPastedKey, validateKey } from "./lib/gemini.js";
import { trackEvent } from "./analytics.js";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The one-time "Connect Gemini" dialog (and, in `manage` mode, the place to
 * replace or forget the key).
 *
 * The dialog's state lives in an inner component that mounts only while open,
 * so every open starts fresh without any state-resetting effects.
 */
export default function ConnectGeminiModal(props) {
  if (!props.open) return null;
  return <ConnectDialog {...props} />;
}

/** Where focus goes on close when the opener is gone or was never an element (the dialog opened itself). */
function focusFallback() {
  return document.querySelector("[data-focus-fallback]") ?? document.querySelector(".chip");
}

function ConnectDialog({ mode = "connect", initialError = "", onConnected, onForget, onClose }) {
  const [keyInput, setKeyInput] = useState("");
  const [remember, setRemember] = useState(true);
  const [show, setShow] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState(initialError);

  const dialogRef = useRef(null);
  const inputRef = useRef(null);
  const testRef = useRef(null); // AbortController for the key test in flight

  const manage = mode === "manage";
  const cleaned = cleanPastedKey(keyInput);
  const unusualFormat = cleaned.length > 0 && !cleaned.startsWith("AIza");

  // On open: log it, make the page behind inert, move focus in, lock scroll.
  // On close: undo all of that, abort any key test still running, and put
  // focus back where it was — or, when the dialog opened itself (a stored key
  // failed mid-generation) and the opener is <body> or gone, on the URL field.
  useEffect(() => {
    trackEvent("connect_open", { mode });
    const previouslyFocused = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    const page = document.getElementById("root");
    document.body.style.overflow = "hidden";
    if (page) page.inert = true;
    inputRef.current?.focus();
    return () => {
      testRef.current?.abort();
      document.body.style.overflow = previousOverflow;
      if (page) page.inert = false;
      const opener = previouslyFocused && previouslyFocused !== document.body && previouslyFocused.isConnected ? previouslyFocused : null;
      (opener ?? focusFallback())?.focus?.();
    };
  }, [mode]);

  // Escape / Tab are handled at the document level: focus can land on <body>
  // while the controls are disabled during a key test, and the dialog must
  // still respond. Re-registering when `onClose` changes is cheap.
  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose?.();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      // Keep Tab inside the dialog (and pull it back in if it escaped).
      const nodes = Array.from(dialogRef.current.querySelectorAll(FOCUSABLE));
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;
      if (!dialogRef.current.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  function handleBackdropMouseDown(event) {
    if (event.target === event.currentTarget) onClose?.();
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (testRef.current) return;
    const key = cleanPastedKey(keyInput);
    if (!key) {
      setError("Paste your API key first.");
      return;
    }
    const controller = new AbortController();
    testRef.current = controller;
    setTesting(true);
    setError("");
    try {
      await validateKey(key, { signal: controller.signal });
      testRef.current = null;
      trackEvent("connect_success", { remember });
      onConnected?.(key, { remember });
    } catch (err) {
      testRef.current = null;
      if (err?.type === "cancelled") return; // the user closed the dialog mid-test
      setTesting(false);
      setError(err?.message || "That key didn't work. Please try again.");
      trackEvent("connect_error", { error_type: err?.type || "unknown", status: err?.status || 0 });
      // The disabled field dropped focus while testing; put it back once re-enabled.
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }

  function handleForget() {
    trackEvent("key_forgotten");
    onForget?.();
  }

  const dialog = (
    <div className="modal-backdrop" onMouseDown={handleBackdropMouseDown}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="connect-title"
        aria-describedby="connect-lead"
        ref={dialogRef}
      >
        <h2 id="connect-title" className="modal__title">
          {manage ? "Manage your Gemini key" : "Connect Gemini"}
        </h2>
        <p id="connect-lead" className="modal__lead">
          {manage
            ? `${MODEL_LABEL} is connected. Paste a new key to replace it, or forget it to disconnect.`
            : "Takes about a minute. Google's free key allows up to 20 requests and 8 hours of video a day."}
        </p>

        <form className="connect-form" onSubmit={handleSubmit} noValidate>
          <ol className="connect-steps">
            <li>
              <span className="connect-steps__num" aria-hidden="true">1</span>
              <div>
                Get a free key at{" "}
                <a
                  href={AI_STUDIO_KEY_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => trackEvent("outbound_click", { link_url: AI_STUDIO_KEY_URL })}
                >
                  Google AI Studio
                  <ExternalLink size={13} aria-hidden="true" className="connect-steps__ext" />
                </a>
                . Make one just for this site, so you can revoke it any time.
              </div>
            </li>
            <li>
              <span className="connect-steps__num" aria-hidden="true">2</span>
              <div className="connect-steps__field">
                <label htmlFor="gemini-key">Paste your API key</label>
                <div className="keyfield">
                  <input
                    id="gemini-key"
                    ref={inputRef}
                    type={show ? "text" : "password"}
                    className="keyfield__input"
                    placeholder="AIza…"
                    value={keyInput}
                    onChange={(event) => {
                      setKeyInput(event.target.value);
                      if (error) setError("");
                    }}
                    autoComplete="off"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck="false"
                    data-1p-ignore
                    data-lpignore="true"
                    data-bwignore
                    disabled={testing}
                  />
                  <button
                    type="button"
                    className="keyfield__toggle"
                    onClick={() => setShow((s) => !s)}
                    aria-label={show ? "Hide key" : "Show key"}
                    title={show ? "Hide key" : "Show key"}
                  >
                    {show ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {unusualFormat && !error && (
                  <p className="modal__hint">Keys from AI Studio usually start with AIza. We'll test this one anyway.</p>
                )}
              </div>
            </li>
          </ol>

          <label className="remember">
            <input
              type="checkbox"
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
              disabled={testing}
            />
            Remember on this device
          </label>

          {error && (
            <p className="modal__error" role="alert">
              <AlertCircle size={15} aria-hidden="true" />
              {error}
            </p>
          )}

          <div className="modal__actions">
            {manage && (
              <button type="button" className="btn btn--danger" onClick={handleForget} disabled={testing}>
                Forget key
              </button>
            )}
            <span className="modal__spacer" />
            <button type="button" className="btn btn--ghost" onClick={() => onClose?.()}>
              Cancel
            </button>
            <button type="submit" className="generate-btn" disabled={testing}>
              {testing ? "Testing…" : manage ? "Test and replace" : "Test and connect"}
            </button>
          </div>
        </form>

        <p className="modal__foot">
          Stored only in this browser, never on our servers. Forget it any time from the Gemini button at the top.
        </p>
        <p className="modal__foot">
          Free keys: Google may use what you send to improve its products, and its reviewers may read it. You must be
          18 or older. In the EEA, UK or Switzerland, Google's terms require a key with billing enabled.{" "}
          <a href={GEMINI_TERMS_URL} target="_blank" rel="noopener noreferrer">
            Gemini API terms
            <ExternalLink size={11} aria-hidden="true" className="connect-steps__ext" />
          </a>
        </p>
      </div>
    </div>
  );

  // Rendered outside the app root so the page behind can be made inert.
  return createPortal(dialog, document.body);
}
