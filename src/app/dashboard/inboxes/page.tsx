import { Inbox as InboxIcon, Plus } from "lucide-react";
import { listInboxes, getProfile } from "@/server/queries";
import { isConfigured } from "@/lib/env";
import { EmptyState, ErrorPanel, InboxStatusBadge, PageHeader, formatDateTime, timeAgo } from "@/components/ui";
import { FlashFromQuery } from "@/components/flash";
import { DisconnectForm, RenameForm, SyncNowButton } from "./forms";
import { INBOX_ERRORS } from "@/lib/messages";

export const metadata = { title: "Inboxes — PingDesk" };

const ERRORS: Record<string, string> = {
  google_not_configured: "Gmail connections aren't available yet: the Google OAuth client hasn't been configured on this PingDesk server.",
  state_mismatch: "That connection attempt expired or didn't start from your account. Start again from this page.",
  access_denied: "You cancelled the Google permission screen. Nothing was connected.",
  scope_missing: "PingDesk needs the “Read your email messages” permission to see notifications. Try again and leave it ticked.",
  no_refresh_token: "Google didn't grant long-term access. Remove PingDesk at myaccount.google.com/permissions, then connect again.",
  google_error: "Google returned an error. Try connecting again.",
  connect_failed: "We couldn't finish connecting that inbox. Try again in a moment.",
  rate_limited: "Too many connection attempts. Wait a while and try again.",
};

export default async function InboxesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  let inboxes: Awaited<ReturnType<typeof listInboxes>>;
  let tz = "UTC";
  try {
    [inboxes, tz] = await Promise.all([listInboxes(), getProfile().then((p) => p?.timezone ?? "UTC")]);
  } catch (e) {
    return <ErrorPanel message={e instanceof Error ? e.message : "Unknown error."} />;
  }
  const googleReady = isConfigured("google");
  const connectButton = googleReady ? (
    <a className="btn btn-primary" href="/api/google/connect">
      <Plus size={15} aria-hidden /> Connect Gmail
    </a>
  ) : null;

  return (
    <>
      <FlashFromQuery value={sp.connected ? "Inbox connected. PingDesk will start checking it for Fiverr notifications." : undefined} />
      <FlashFromQuery tone="error" value={sp.error ? (ERRORS[sp.error] ?? ERRORS.connect_failed) : undefined} />
      <PageHeader
        eyebrow="CONNECTIONS"
        title="Inboxes"
        description="Gmail accounts PingDesk watches for Fiverr notifications. Access is read-only and you can revoke it any time."
        action={inboxes.length ? connectButton : null}
      />
      {!googleReady ? (
        <p className="alert alert-warning">Gmail connections are unavailable until the server&apos;s Google OAuth settings are configured.</p>
      ) : null}

      {inboxes.length === 0 ? (
        <EmptyState
          icon={<InboxIcon size={20} />}
          title="No inboxes connected"
          body="Connect the Gmail account that receives your Fiverr notifications. You'll approve read-only access on Google's own page."
          action={connectButton}
        />
      ) : (
        <ul className="cards">
          {inboxes.map((inbox) => (
            <li key={inbox.id} className={`card inbox-card ${inbox.status === "disconnected" ? "is-off" : ""}`}>
              <div className="inbox-top">
                <span className="tile" aria-hidden>
                  <InboxIcon size={18} />
                </span>
                <div className="grow">
                  <RenameForm inboxId={inbox.id} label={inbox.label} disabled={inbox.status === "disconnected"} />
                  <small className="muted">{inbox.email_address}</small>
                </div>
                <InboxStatusBadge status={inbox.status} />
              </div>
              <dl className="meta">
                <div>
                  <dt>Connected</dt>
                  <dd>{formatDateTime(inbox.connected_at, tz)}</dd>
                </div>
                <div>
                  <dt>Last checked</dt>
                  <dd>{inbox.last_synced_at ? timeAgo(inbox.last_synced_at) : "Not yet"}</dd>
                </div>
              </dl>
              {inbox.status === "needs_reauth" || inbox.status === "error" ? (
                <p className="alert alert-warning">
                  {inbox.status === "needs_reauth"
                    ? `${INBOX_ERRORS[inbox.last_error_code ?? ""] ?? "Google access stopped working."} Reconnect to resume alerts.`
                    : `${INBOX_ERRORS[inbox.last_error_code ?? ""] ?? INBOX_ERRORS.unknown} If this continues, try reconnecting.`}
                </p>
              ) : inbox.status === "active" && inbox.last_error_code ? (
                <p className="alert alert-warning">{INBOX_ERRORS[inbox.last_error_code] ?? INBOX_ERRORS.unknown}</p>
              ) : null}
              <div className="card-actions">
                {inbox.status === "active" || inbox.status === "error" ? <SyncNowButton inboxId={inbox.id} /> : null}
                {inbox.status !== "active" && googleReady ? (
                  <a className="btn btn-outline btn-sm" href="/api/google/connect">
                    Reconnect
                  </a>
                ) : null}
                <DisconnectForm inboxId={inbox.id} label={inbox.label} alreadyDisconnected={inbox.status === "disconnected"} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
