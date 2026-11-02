"use client";

import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, X } from "lucide-react";

/** Dismissible one-time notice driven by a query parameter (e.g. after OAuth). */
export function FlashFromQuery({ value, tone = "success" }: { value?: string; tone?: "success" | "error" }) {
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    if (!value) return;
    // Drop the query string so a refresh doesn't show it again.
    const url = new URL(window.location.href);
    url.search = "";
    window.history.replaceState(null, "", url);
  }, [value]);
  if (!value || dismissed) return null;
  return (
    <div className={`alert alert-${tone} flash`} role={tone === "error" ? "alert" : "status"}>
      {tone === "error" ? <AlertCircle size={16} aria-hidden /> : <CheckCircle2 size={16} aria-hidden />}
      <span className="grow">{value}</span>
      <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => setDismissed(true)}>
        <X size={15} />
      </button>
    </div>
  );
}
