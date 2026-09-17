import { useEffect, useRef, useState } from "react";
import { AlertCircle, ExternalLink, Eye, EyeOff } from "lucide-react";

import { AI_STUDIO_KEY_URL, MODEL_LABEL, validateKey } from "./lib/gemini.js";
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

function ConnectDialog({ mode = "connect", initialError = "", onConnected, onForget, onClose }) {
  const [keyInput, setKeyInput] = useState("");
  const [remember, setRemember] = useState(true);
  const [show, setShow] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState(initialError);

  const dialogRef = useRef(null);
  const inputRef = useRef(null);
  const testingRef = useRef(false);

  const manage = mode === "manage";

  // On open: log it, move focus into the dialog, lock page scroll. On close:
  // restore scroll and focus. No state is set here.
  useEffect(() => {
    trackEvent("connect_open", { mode });
    const previouslyFocused = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    inputRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      if (previouslyFocused && typeof previouslyFocused.focus === "function") previouslyFocused.focus();
    };
  }, [mode]);

  // Escape / Tab are handled at the document level: focus can land on <body>
  // while the controls are disabled during a key test, and the dialog must
  // still respond. Re-registering when `onClose` changes is cheap.
  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!testingRef.current) onClose?.();
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

  function requestClose() {
    if (testingRef.current) return;
    onClose?.();
  }

  function handleBackdropMouseDown(event) {
    if (event.target === event.currentTarget) requestClose();
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (testingRef.current) return;
    const key = keyInput.trim();
    if (!key) {
      setError("Paste your API key first.");
      return;
    }
    testingRef.current = true;
    setTesting(true);
    setError("");
    try {
      await validateKey(key);
      trackEvent("connect_success", { remember });
      testingRef.current = false;
      onConnected?.(key, { remember });
    } catch (err) {
      testingRef.current = false;
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

  return (
    <div className="modal-backdrop" onMouseDown={handleBackdropMouseDown}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="connect-title"
        ref={dialogRef}
      >
        <h2 id="connect-title" className="modal__title">
          {manage ? "Manage your Gemini key" : "Connect Gemini"}
        </h2>
        <p className="modal__lead">
          {manage
            ? `${MODEL_LABEL} is connected. Paste a new key to replace it, or forget it to disconnect.`
            : "Takes about a minute. Google gives you a free key with enough for roughly ten sermons a day."}
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
                    spellCheck="false"
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
            <button type="button" className="btn btn--ghost" onClick={requestClose} disabled={testing}>
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
      </div>
    </div>
  );
}
