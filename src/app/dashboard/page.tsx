import Link from "next/link";
import { ArrowRight, Bell, CheckCircle2, Inbox, MessageCircle, XCircle } from "lucide-react";
import { getOverview, getProfile } from "@/server/queries";
import { CategoryTag, EmptyState, ErrorPanel, InboxStatusBadge, NotificationStatusBadge, PageHeader, formatDateTime, timeAgo } from "@/components/ui";
import { FlashFromQuery } from "@/components/flash";

export const metadata = { title: "Overview — PingDesk" };

export default async function OverviewPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  let data: Awaited<ReturnType<typeof getOverview>>;
  let tz = "UTC";
  try {
    [data, tz] = await Promise.all([getOverview(), getProfile().then((p) => p?.timezone ?? "UTC")]);
  } catch (e) {
    return <ErrorPanel message={e instanceof Error ? e.message : "Unknown error."} />;
  }
  const { totals, inboxes, whatsapp, recent } = data;
  const needsAttention = inboxes.filter((i) => i.status !== "active");
  const whatsappReady = whatsapp?.status === "verified";
  const setupDone = inboxes.length > 0 && whatsappReady;

  return (
    <>
      <FlashFromQuery value={sp.password === "updated" ? "Password updated." : undefined} />
      <PageHeader eyebrow="OVERVIEW" title="Your notification desk" description="Live totals from your account. Nothing here is sample data." />

      {!setupDone ? (
        <section className="panel setup" aria-labelledby="setup-title">
          <h2 id="setup-title">Finish setting up</h2>
          <ol className="steps">
            <li className={inboxes.length ? "done" : ""}>
              <span className="step-dot">{inboxes.length ? <CheckCircle2 size={16} /> : 1}</span>
              <div>
                <b>Connect a Gmail inbox</b>
                <p>Read-only access through Google. We never see your password.</p>
              </div>
              {!inboxes.length ? (
                <Link className="btn btn-primary btn-sm" href="/dashboard/inboxes">
                  Connect Gmail
                </Link>
              ) : null}
            </li>
            <li className={whatsappReady ? "done" : ""}>
              <span className="step-dot">{whatsappReady ? <CheckCircle2 size={16} /> : 2}</span>
              <div>
                <b>Verify your WhatsApp number</b>
                <p>Alerts go only to a number you&apos;ve confirmed.</p>
              </div>
              {!whatsappReady ? (
                <Link className="btn btn-outline btn-sm" href="/dashboard/whatsapp">
                  Set up WhatsApp
                </Link>
              ) : null}
            </li>
          </ol>
        </section>
      ) : null}

      <section className="stats" aria-label="Alert totals">
        <div className="stat">
          <span className="stat-icon" aria-hidden>
            <Bell size={16} />
          </span>
          <small>Total alerts</small>
          <strong>{totals.total.toLocaleString()}</strong>
        </div>
        <div className="stat">
          <span className="stat-icon ok" aria-hidden>
            <CheckCircle2 size={16} />
          </span>
          <small>Delivered</small>
          <strong>{totals.delivered.toLocaleString()}</strong>
        </div>
        <div className="stat">
          <span className="stat-icon bad" aria-hidden>
            <XCircle size={16} />
          </span>
          <small>Failed</small>
          <strong>{totals.failed.toLocaleString()}</strong>
        </div>
      </section>

      <div className="grid-2">
        <section className="panel" aria-labelledby="conn-title">
          <div className="panel-head">
            <h2 id="conn-title">Connections</h2>
            <Link href="/dashboard/inboxes" className="text-link small">
              Manage
            </Link>
          </div>
          <ul className="list">
            {inboxes.length === 0 ? (
              <li className="list-row muted-row">
                <Inbox size={16} aria-hidden /> No inbox connected yet.
              </li>
            ) : (
              inboxes.map((i) => (
                <li key={i.id} className="list-row">
                  <Inbox size={16} aria-hidden />
                  <div className="grow">
                    <b>{i.label}</b>
                    <small>{i.last_synced_at ? `Checked ${timeAgo(i.last_synced_at)}` : "Waiting for first check"}</small>
                  </div>
                  <InboxStatusBadge status={i.status} />
                </li>
              ))
            )}
            <li className="list-row">
              <MessageCircle size={16} aria-hidden />
              <div className="grow">
                <b>WhatsApp</b>
                <small>{whatsapp ? `Ends in ${whatsapp.phone_e164.slice(-4)}` : "No number added"}</small>
              </div>
              {whatsappReady ? <span className="badge badge-success">Verified</span> : <span className="badge badge-muted">Not set up</span>}
            </li>
          </ul>
          {needsAttention.length ? (
            <p className="alert alert-warning">
              {needsAttention.length === 1 ? "One inbox needs" : `${needsAttention.length} inboxes need`} attention. Alerts from{" "}
              {needsAttention.length === 1 ? "it" : "them"} are paused until you reconnect.
            </p>
          ) : null}
        </section>

        <section className="panel" aria-labelledby="recent-title">
          <div className="panel-head">
            <h2 id="recent-title">Recent alerts</h2>
            <Link href="/dashboard/history" className="text-link small">
              View all <ArrowRight size={13} aria-hidden />
            </Link>
          </div>
          {recent.length === 0 ? (
            <EmptyState
              icon={<Bell size={18} />}
              title="No alerts yet"
              body={inboxes.length ? "When a Fiverr notification reaches your inbox it will appear here." : "Connect an inbox and your Fiverr notifications will appear here."}
            />
          ) : (
            <ul className="list">
              {recent.map((n) => (
                <li key={n.id} className="list-row">
                  <CategoryTag category={n.category} />
                  <div className="grow">
                    <b className="truncate">{n.inbox_label}</b>
                    <small title={formatDateTime(n.received_at, tz)}>{timeAgo(n.received_at)}</small>
                  </div>
                  <NotificationStatusBadge status={n.status} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
