import Link from "next/link";
import type { ReactNode } from "react";
import { CATEGORY_LABELS, type AlertCategory } from "@/lib/email/classify";
import type { InboxStatus, NotificationStatus } from "@/lib/db/types";

export function PageHeader({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        {description ? <p className="page-desc">{description}</p> : null}
      </div>
      {action ? <div className="page-action">{action}</div> : null}
    </header>
  );
}

export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-icon" aria-hidden>
        {icon}
      </span>
      <h3>{title}</h3>
      <p>{body}</p>
      {action}
    </div>
  );
}

const NOTIFICATION_STATUS: Record<NotificationStatus, { label: string; tone: string }> = {
  received: { label: "Received", tone: "neutral" },
  queued: { label: "Queued", tone: "neutral" },
  delivering: { label: "Sending", tone: "info" },
  delivered: { label: "Delivered", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  skipped: { label: "Skipped", tone: "muted" },
};

const INBOX_STATUS: Record<InboxStatus, { label: string; tone: string }> = {
  active: { label: "Connected", tone: "success" },
  needs_reauth: { label: "Reconnect needed", tone: "warning" },
  error: { label: "Sync error", tone: "danger" },
  disconnected: { label: "Disconnected", tone: "muted" },
};

export function Badge({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export const NotificationStatusBadge = ({ status }: { status: NotificationStatus }) => (
  <Badge tone={NOTIFICATION_STATUS[status].tone}>{NOTIFICATION_STATUS[status].label}</Badge>
);

export const InboxStatusBadge = ({ status }: { status: InboxStatus }) => (
  <Badge tone={INBOX_STATUS[status].tone}>{INBOX_STATUS[status].label}</Badge>
);

export const CategoryTag = ({ category }: { category: AlertCategory }) => (
  <span className={`tag tag-${category}`}>{CATEGORY_LABELS[category]}</span>
);

export function formatDateTime(iso: string, timeZone = "UTC") {
  try {
    return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone }).format(new Date(iso));
  } catch {
    return new Date(iso).toISOString().slice(0, 16).replace("T", " ") + " UTC";
  }
}

export function timeAgo(iso: string, now = Date.now()) {
  const s = Math.round((now - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

export function ErrorPanel({ message }: { message: string }) {
  return (
    <div className="panel panel-error" role="alert">
      <b>Something went wrong loading this page.</b>
      <p>{message} Refresh to try again.</p>
    </div>
  );
}

export const TextLink = ({ href, children }: { href: string; children: ReactNode }) => (
  <Link href={href} className="text-link">
    {children}
  </Link>
);
