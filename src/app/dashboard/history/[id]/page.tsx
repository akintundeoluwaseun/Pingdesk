import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCircle2, Clock, Send, XCircle, Eye } from "lucide-react";
import { getNotificationDetail, getProfile } from "@/server/queries";
import { CategoryTag, ErrorPanel, NotificationStatusBadge, PageHeader, formatDateTime } from "@/components/ui";
import { describeDeliveryError, SKIP_REASONS } from "@/lib/messages";

export const metadata = { title: "Alert details — PingDesk" };

export default async function AlertDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let detail: Awaited<ReturnType<typeof getNotificationDetail>>;
  let tz = "UTC";
  try {
    [detail, tz] = await Promise.all([getNotificationDetail(id), getProfile().then((p) => p?.timezone ?? "UTC")]);
  } catch (e) {
    return <ErrorPanel message={e instanceof Error ? e.message : "Unknown error."} />;
  }
  const n = detail.notification;
  if (!n) notFound();
  const t = (iso: string | null) => (iso ? formatDateTime(iso, tz) : null);

  return (
    <>
      <Link href="/dashboard/history" className="text-link small back-link">
        <ArrowLeft size={14} aria-hidden /> Back to history
      </Link>
      <PageHeader eyebrow="ALERT" title={n.subject ?? "Fiverr notification"} />

      <section className="panel">
        <dl className="detail-grid">
          <div>
            <dt>Category</dt>
            <dd>
              <CategoryTag category={n.category} />
            </dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>
              <NotificationStatusBadge status={n.status} />
            </dd>
          </div>
          <div>
            <dt>Inbox</dt>
            <dd>{n.inbox_label}</dd>
          </div>
          <div>
            <dt>Received in Gmail</dt>
            <dd>{t(n.received_at)}</dd>
          </div>
          <div>
            <dt>Detected by PingDesk</dt>
            <dd>{t(n.created_at)}</dd>
          </div>
          <div>
            <dt>Verified sender</dt>
            <dd>{n.sender_domain}</dd>
          </div>
        </dl>
        {n.status === "skipped" && n.skip_reason ? (
          <p className="alert alert-warning">Not sent to WhatsApp: {SKIP_REASONS[n.skip_reason] ?? n.skip_reason}.</p>
        ) : null}
        {n.status === "queued" && n.next_attempt_at ? (
          <p className="alert alert-warning">Waiting to retry — next attempt around {t(n.next_attempt_at)}.</p>
        ) : null}
      </section>

      <section className="panel" aria-labelledby="attempts-h">
        <h2 id="attempts-h">WhatsApp delivery</h2>
        {detail.attempts.length === 0 ? (
          <p className="muted">{n.status === "skipped" ? "No message was sent for this alert." : "No delivery attempts yet."}</p>
        ) : (
          <ol className="timeline">
            {detail.attempts.map((a) => (
              <li key={a.attempt}>
                <div className="timeline-head">
                  <b>Attempt {a.attempt}</b>
                  {a.recipient_last4 ? <span className="muted small">to number ending {a.recipient_last4}</span> : null}
                </div>
                <ul className="steps-inline">
                  {a.submitted_at ? (
                    <li>
                      <Send size={13} aria-hidden /> Submitted {t(a.submitted_at)}
                    </li>
                  ) : null}
                  {a.sent_at ? (
                    <li>
                      <Clock size={13} aria-hidden /> Sent {t(a.sent_at)}
                    </li>
                  ) : null}
                  {a.delivered_at ? (
                    <li className="ok">
                      <CheckCircle2 size={13} aria-hidden /> Delivered {t(a.delivered_at)}
                    </li>
                  ) : null}
                  {a.read_at ? (
                    <li className="ok">
                      <Eye size={13} aria-hidden /> Read {t(a.read_at)}
                    </li>
                  ) : null}
                  {a.failed_at ? (
                    <li className="bad">
                      <XCircle size={13} aria-hidden /> Failed {t(a.failed_at)} — {describeDeliveryError(a.error_code, a.error_title)}
                    </li>
                  ) : null}
                </ul>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
