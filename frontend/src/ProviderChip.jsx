import { Check, KeyRound } from "lucide-react";

import { MODEL_LABEL } from "./lib/gemini.js";

/** Top-bar pill showing whether a Gemini key is connected; opens the key dialog. */
export default function ProviderChip({ connected, onClick }) {
  return (
    <button
      type="button"
      className={`chip ${connected ? "chip--on" : ""}`}
      onClick={onClick}
      aria-label={connected ? `${MODEL_LABEL} connected. Manage your key` : "Connect Gemini"}
      title={connected ? "Manage your Gemini key" : "Connect your free Gemini key"}
    >
      {connected ? <Check size={14} aria-hidden="true" /> : <KeyRound size={14} aria-hidden="true" />}
      <span className="chip__label">{connected ? MODEL_LABEL : "Connect Gemini"}</span>
    </button>
  );
}
