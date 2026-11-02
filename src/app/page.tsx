import Link from "next/link";
import { Activity, ArrowUpRight, Bell, Mail, MessageCircle, ShieldCheck } from "lucide-react";
import { getUser } from "@/lib/supabase/server";
import { FlashFromQuery } from "@/components/flash";

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [sp, user] = await Promise.all([searchParams, getUser().catch(() => null)]);
  return (
    <main className="shell">
      <nav className="nav">
        <div className="brand">
          <span className="mark">
            <Activity size={18} aria-hidden />
          </span>{" "}
          pingdesk
        </div>
        <div className="row">
          {user ? (
            <Link className="primary" href="/dashboard">
              Open dashboard
            </Link>
          ) : (
            <>
              <Link className="outline nav-signin" href="/login">
                Sign in
              </Link>
              <Link className="primary" href="/register">
                Get started
              </Link>
            </>
          )}
        </div>
      </nav>
      <FlashFromQuery value={sp.account === "deleted" ? "Your account and all its data were deleted." : undefined} />
      <section className="hero">
        <p className="eyebrow">FIVERR ALERTS ON WHATSAPP</p>
        <h1>
          Stay close to
          <br />
          <span>what matters.</span>
        </h1>
        <p className="sub">
          PingDesk watches your Gmail for Fiverr notifications and pings your WhatsApp the moment a new order, message or payment lands —
          even when your laptop is off.
        </p>
        <Link className="primary" href={user ? "/dashboard" : "/register"}>
          {user ? "Open dashboard" : "Set up PingDesk"} <ArrowUpRight size={16} aria-hidden />
        </Link>
      </section>

      <section className="section" aria-labelledby="how">
        <p className="eyebrow">HOW IT WORKS</p>
        <h2 id="how">Three steps. Then it just runs.</h2>
        <div className="connection">
          <span className="tile">
            <Mail aria-hidden />
          </span>
          <div>
            <b>1. Connect Gmail</b>
            <p>Approve read-only access on Google&apos;s own screen. No passwords shared, revoke any time.</p>
          </div>
        </div>
        <div className="connection">
          <span className="tile green">
            <MessageCircle aria-hidden />
          </span>
          <div>
            <b>2. Verify your WhatsApp</b>
            <p>Opt in and confirm your number. Alerts come from PingDesk&apos;s official WhatsApp Business number.</p>
          </div>
        </div>
        <div className="connection">
          <span className="tile">
            <Bell aria-hidden />
          </span>
          <div>
            <b>3. Pick what matters</b>
            <p>Orders, buyer messages, payments, security — choose which categories ping you.</p>
          </div>
        </div>
      </section>

      <section className="section">
        <p className="eyebrow">BUILT AROUND TRUST</p>
        <h2>Useful alerts. No platform shortcuts.</h2>
        <div className="features">
          <article>
            <ShieldCheck aria-hidden />
            <b>Authorized access</b>
            <p>OAuth-based, read-only email access. No inbox or Fiverr passwords.</p>
          </article>
          <article>
            <Bell aria-hidden />
            <b>Notification only</b>
            <p>Alerts tell you what happened and send you back to Fiverr. Message contents stay private.</p>
          </article>
          <article>
            <Activity aria-hidden />
            <b>Delivery visibility</b>
            <p>See every alert that was detected, sent, delivered or skipped.</p>
          </article>
        </div>
      </section>
      <footer>
        PingDesk <span>Not affiliated with Fiverr, Google or Meta.</span>
      </footer>
    </main>
  );
}
