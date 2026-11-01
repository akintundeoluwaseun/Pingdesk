"use client";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0, background: "#f7f8fa" }}>
        <div style={{ textAlign: "center", maxWidth: 380, padding: 24 }}>
          <h1 style={{ fontSize: 22 }}>Something went wrong</h1>
          <p style={{ color: "#6b7480" }}>PingDesk hit an unexpected error. Your alerts keep running in the background.</p>
          {error.digest ? <p style={{ color: "#6b7480", fontSize: 12 }}>Reference: {error.digest}</p> : null}
          <button onClick={reset} style={{ padding: "10px 16px", borderRadius: 9, border: 0, background: "#171b20", color: "#fff", cursor: "pointer" }}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
