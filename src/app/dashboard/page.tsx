import Link from "next/link";
import { Mail, MessageCircle, CheckCircle2, Circle, AlertTriangle } from "lucide-react";
import { AppNav, Flash } from "@/components/AppNav";
import { ConfirmButton } from "@/components/ConfirmButton";
import { requireUser } from "@/lib/auth/user";
import { whatsappConfigured } from "@/lib/whatsapp/send";
import { CATEGORY_LABEL, type AlertCategory } from "@/lib/email/classify";
import { disconnectInbox } from "@/app/settings/actions";

export const metadata = { title: "Dashboard · PingDesk" };
export const dynamic = "force-dynamic";

type Inbox = { id: string; email_address: string; status: string; last_synced_at: string | null; last_error: string | null };
type Row = { id: string; category: AlertCategory; subject: string | null; received_at: string | null; created_at: string; processing_status: string; skip_reason: string | null; delivery_logs: { delivery_status: string; created_at: string }[] };

const SKIP: Record<string, string> = { no_opt_in: "WhatsApp alerts off", no_number: "No WhatsApp number", category_off: "Category turned off" };

function ago(iso: string | null) {
  if (!iso) return "never";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

function statusOf(r: Row) {
  const last = [...(r.delivery_logs ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at))[0]?.delivery_status;
  if (r.processing_status === "ignored") return { label: SKIP[r.skip_reason ?? ""] ?? "Skipped", tone: "grey" };
  if (r.processing_status === "failed") return { label: "Failed", tone: "red" };
  if (r.processing_status === "queued" || r.processing_status === "processing") return { label: last === "failed" ? "Retrying" : "Waiting", tone: "amber" };
  if (last === "read") return { label: "Read", tone: "green" };
  if (last === "delivered") return { label: "Delivered", tone: "green" };
  if (last === "failed") return { label: "Not delivered", tone: "red" };
  return { label: "Sent", tone: "green" };
}

export default async function Dashboard({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, user } = await requireUser("/dashboard");
  const since = new Date(); since.setHours(0, 0, 0, 0);

  const [{ data: inboxes }, { data: prefs }, { data: rows }, { count: today }] = await Promise.all([
    supabase.from("connected_inboxes").select("id,email_address,status,last_synced_at,last_error").order("created_at"),
    supabase.from("notification_preferences").select("whatsapp_number,whatsapp_opt_in").eq("user_id", user.id).maybeSingle(),
    supabase.from("notifications").select("id,category,subject,received_at,created_at,processing_status,skip_reason,delivery_logs(delivery_status,created_at)").order("created_at", { ascending: false }).limit(25),
    supabase.from("notifications").select("id", { count: "exact", head: true }).gte("created_at", since.toISOString()),
  ]);
  const list = (inboxes ?? []) as Inbox[];
  const alerts = (rows ?? []) as Row[];
  const counted = alerts.filter((r) => r.processing_status !== "ignored");
  const delivered = counted.filter((r) => ["Delivered", "Read", "Sent"].includes(statusOf(r).label)).length;
  const hasInbox = list.some((i) => i.status === "active");
  const hasWhatsApp = Boolean(prefs?.whatsapp_opt_in && prefs.whatsapp_number);
  const serverReady = whatsappConfigured();
  const steps = [
    { done: hasInbox, label: "Connect a Gmail inbox", href: "/api/google/connect", cta: "Connect Gmail" },
    { done: hasWhatsApp, label: "Add your WhatsApp number and turn alerts on", href: "/settings", cta: "Open settings" },
  ];

  return (
    <main className="shell">
      <AppNav active="dashboard" email={user.email} />
      <header className="page-head"><p className="eyebrow">DASHBOARD</p><h1 className="h-sm">Your alerts</h1></header>
      <Flash error={sp.error} notice={sp.connected ? `${sp.connected} is connected. New Fiverr emails will show up here.` : sp.notice} />

      {(!hasInbox || !hasWhatsApp) && (
        <section className="card steps">
          <b>Finish setting up</b>
          {steps.map((s) => (
            <div key={s.label} className={"step" + (s.done ? " done" : "")}>
              {s.done ? <CheckCircle2 size={18} /> : <Circle size={18} />}<span>{s.label}</span>
              {!s.done && <Link className="outline sm" href={s.href} prefetch={false}>{s.cta}</Link>}
            </div>
          ))}
        </section>
      )}
      {!serverReady && <p className="flash warn">WhatsApp sending isn&apos;t configured on the server yet. Alerts are collected and will send once it is.</p>}

      <section className="metrics">
        <div><small>Alerts today</small><strong>{today ?? 0}</strong><small>Fiverr emails picked up since midnight</small></div>
        <div><small>Reached WhatsApp</small><strong>{counted.length ? `${delivered}/${counted.length}` : "—"}</strong><small>Recent alerts you chose to receive</small></div>
      </section>

      <section className="section">
        <div className="row-between"><h2 className="h-xs">Inboxes</h2><Link className="outline sm" href="/api/google/connect" prefetch={false}><Mail size={15} /> Add Gmail</Link></div>
        {list.length === 0 && <p className="muted">No inbox connected yet.</p>}
        {list.map((i) => (
          <div key={i.id} className="connection">
            <span className={"tile" + (i.status === "active" ? " green" : "")}>{i.status === "active" ? <Mail /> : <AlertTriangle />}</span>
            <div>
              <b>{i.email_address}</b>
              <p>{i.status === "active" ? `Checked ${ago(i.last_synced_at)}` : i.status === "needs_reauth" ? "Google access expired. Reconnect to keep getting alerts." : i.status}</p>
              {i.last_error && i.status === "active" && <p className="err-text">{i.last_error}</p>}
            </div>
            <div className="actions">
              {i.status !== "active" && <Link className="outline sm" href="/api/google/connect" prefetch={false}>Reconnect</Link>}
              <form action={disconnectInbox}><input type="hidden" name="inbox_id" value={i.id} />
                <ConfirmButton className="linkbtn danger" message={`Disconnect ${i.email_address}? PingDesk will stop checking it and delete its alert history.`}>Disconnect</ConfirmButton>
              </form>
            </div>
          </div>
        ))}
      </section>

      <section className="section">
        <h2 className="h-xs">Recent alerts</h2>
        {alerts.length === 0 ? (
          <div className="card empty"><MessageCircle /><p>No alerts yet. When a Fiverr email lands in a connected inbox, it appears here and goes to your WhatsApp.</p></div>
        ) : (
          <ul className="alerts">
            {alerts.map((r) => {
              const st = statusOf(r);
              return (
                <li key={r.id}>
                  <div><b>{CATEGORY_LABEL[r.category] ?? r.category}</b><p>{r.subject || "(no subject)"}</p></div>
                  <div className="meta"><span className={`pill ${st.tone}`}>{st.label}</span><small>{ago(r.received_at ?? r.created_at)}</small></div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <footer>PingDesk <span>Alerts point you back to Fiverr. PingDesk never replies or logs in for you.</span></footer>
    </main>
  );
}
