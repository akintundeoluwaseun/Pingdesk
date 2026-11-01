import Link from "next/link";
import { Activity } from "lucide-react";

export default function NotFound() {
  return (
    <main className="auth-shell">
      <Link href="/" className="brand auth-brand">
        <span className="mark">
          <Activity size={18} aria-hidden />
        </span>
        pingdesk
      </Link>
      <div className="auth-card">
        <h1 className="auth-title">Page not found</h1>
        <p className="auth-sub">That page doesn&apos;t exist, or you don&apos;t have access to it.</p>
        <Link href="/dashboard" className="btn btn-primary">
          Go to dashboard
        </Link>
      </div>
    </main>
  );
}
