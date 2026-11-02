"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";

export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(JSON.stringify({ level: "error", event: "ui.dashboard_error", digest: error.digest ?? null }));
  }, [error]);
  return (
    <div className="empty" role="alert">
      <span className="empty-icon" aria-hidden>
        <AlertTriangle size={20} />
      </span>
      <h3>This page didn&apos;t load</h3>
      <p>Your alerts are still running in the background. Try again, and if it keeps happening, check back in a few minutes.</p>
      {error.digest ? <p className="muted small">Reference: {error.digest}</p> : null}
      <button type="button" className="btn btn-primary" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
