import Link from "next/link";
import { History } from "lucide-react";
import { HISTORY_PAGE_SIZE, getProfile, listHistory, parseHistoryFilters } from "@/server/queries";
import { CATEGORIES, CATEGORY_LABELS } from "@/lib/email/classify";
import { CategoryTag, EmptyState, ErrorPanel, NotificationStatusBadge, PageHeader, formatDateTime } from "@/components/ui";

export const metadata = { title: "History — PingDesk" };

const STATUS_OPTIONS = [
  ["delivered", "Delivered"],
  ["failed", "Failed"],
  ["skipped", "Skipped"],
  ["queued", "Queued"],
  ["received", "Received"],
] as const;

const SKIP_REASONS: Record<string, string> = {
  preference_off: "Category turned off",
  paused: "Alerts paused",
  no_whatsapp: "No verified WhatsApp number",
  unclassified: "Not a recognised notification",
  stale: "Older than 6 hours when found",
};

export default async function HistoryPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const filters = parseHistoryFilters(await searchParams);
  let result: Awaited<ReturnType<typeof listHistory>>;
  let tz = "UTC";
  try {
    [result, tz] = await Promise.all([listHistory(filters), getProfile().then((p) => p?.timezone ?? "UTC")]);
  } catch (e) {
    return <ErrorPanel message={e instanceof Error ? e.message : "Unknown error."} />;
  }
  const pages = Math.max(1, Math.ceil(result.total / HISTORY_PAGE_SIZE));
  const filtered = !!(filters.category || filters.status);
  const href = (page: number) => {
    const q = new URLSearchParams();
    if (filters.category) q.set("category", filters.category);
    if (filters.status) q.set("status", filters.status);
    if (page > 1) q.set("page", String(page));
    const s = q.toString();
    return `/dashboard/history${s ? `?${s}` : ""}`;
  };

  return (
    <>
      <PageHeader eyebrow="ACTIVITY" title="Notification history" description="Every Fiverr notification PingDesk detected, and what happened to it." />

      <form className="filters" method="get">
        <label>
          <span>Category</span>
          <select name="category" defaultValue={filters.category ?? ""}>
            <option value="">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Status</span>
          <select name="status" defaultValue={filters.status ?? ""}>
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn btn-outline btn-sm">
          Apply filters
        </button>
        {filtered ? (
          <Link href="/dashboard/history" className="text-link small">
            Clear
          </Link>
        ) : null}
      </form>

      {result.rows.length === 0 ? (
        <EmptyState
          icon={<History size={20} />}
          title={filtered ? "No alerts match these filters" : "No notifications yet"}
          body={filtered ? "Try a different category or status." : "Detected Fiverr notifications will be listed here with their delivery status."}
          action={
            filtered ? (
              <Link className="btn btn-outline btn-sm" href="/dashboard/history">
                Clear filters
              </Link>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Received</th>
                  <th scope="col">Category</th>
                  <th scope="col">Inbox</th>
                  <th scope="col">Subject</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((n) => (
                  <tr key={n.id}>
                    <td data-label="Received" className="nowrap">
                      {formatDateTime(n.received_at, tz)}
                    </td>
                    <td data-label="Category">
                      <CategoryTag category={n.category} />
                    </td>
                    <td data-label="Inbox">{n.inbox_label}</td>
                    <td data-label="Subject" className="subject">
                      <Link href={`/dashboard/history/${n.id}`} className="row-link">
                        {n.subject ?? "Fiverr notification"}
                      </Link>
                    </td>
                    <td data-label="Status">
                      <NotificationStatusBadge status={n.status} />
                      {n.status === "skipped" && n.skip_reason ? (
                        <small className="muted block">{SKIP_REASONS[n.skip_reason] ?? n.skip_reason}</small>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <nav className="pager" aria-label="Pagination">
            <span className="muted small">
              {result.total.toLocaleString()} alert{result.total === 1 ? "" : "s"} · page {filters.page} of {pages}
            </span>
            <div className="row">
              {filters.page > 1 ? (
                <Link className="btn btn-outline btn-sm" href={href(filters.page - 1)}>
                  Previous
                </Link>
              ) : null}
              {filters.page < pages ? (
                <Link className="btn btn-outline btn-sm" href={href(filters.page + 1)}>
                  Next
                </Link>
              ) : null}
            </div>
          </nav>
        </>
      )}
    </>
  );
}
