import Link from "next/link";
import { Activity } from "lucide-react";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth-shell">
      <Link href="/" className="brand auth-brand">
        <span className="mark">
          <Activity size={18} aria-hidden />
        </span>
        pingdesk
      </Link>
      <div className="auth-card">{children}</div>
      <p className="auth-foot">Notification-only. PingDesk never asks for your Gmail or Fiverr password.</p>
    </main>
  );
}
