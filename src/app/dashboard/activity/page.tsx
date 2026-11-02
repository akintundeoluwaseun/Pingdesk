import Link from "next/link";
import { ScrollText } from "lucide-react";
import { ACTIVITY_PAGE_SIZE, getProfile, listActivity } from "@/server/queries";
import { EmptyState, ErrorPanel, PageHeader, formatDateTime } from "@/components/ui";
import { ACTIVITY_LABELS } from "@/lib/messages";

export const metadata = { title: "Activity — PingDesk" };

export default async function ActivityPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const page = Math.max(1, Math.min(1000, Number.parseInt((await searchParams).page ?? "1", 10) || 1));
  let result: Awaited<ReturnType<typeof listActivity>>;
  let tz = "UTC";
  try {
    [result, tz] = await Promise.all([listActivity(page), getProfile().then((p) => p?.timezone ?? "UTC")]);
  } catch (e) {
    return <ErrorPanel message={e instanceof Error ? e.message : "Unknown error."} />;
  }
  const pages = Math.max(1, Math.ceil(result.total / ACTIVITY_PAGE_SIZE));

  return (
    <>
      <PageHeader eyebrow="ACCOUNT" title="Activity" description="Changes to your connections and settings, and anything that needed your attention." />
      {result.rows.length === 0 ? (
        <EmptyState icon={<ScrollText size={20} />} title="No activity yet" body="Connecting an inbox, verifying WhatsApp and changing settings will show up here." />
      ) : (
        <>
          <ul className="panel list activity">
            {result.rows.map((r) => (
              <li key={r.id} className="list-row">
                <div className="grow">
                  <b>{ACTIVITY_LABELS[r.event]?.(r.details) ?? r.event}</b>
                </div>
                <small className="muted nowrap">{formatDateTime(r.created_at, tz)}</small>
              </li>
            ))}
          </ul>
          {pages > 1 ? (
            <nav className="pager" aria-label="Pagination">
              <span className="muted small">
                Page {page} of {pages}
              </span>
              <div className="row">
                {page > 1 ? (
                  <Link className="btn btn-outline btn-sm" href={`/dashboard/activity?page=${page - 1}`}>
                    Newer
                  </Link>
                ) : null}
                {page < pages ? (
                  <Link className="btn btn-outline btn-sm" href={`/dashboard/activity?page=${page + 1}`}>
                    Older
                  </Link>
                ) : null}
              </div>
            </nav>
          ) : null}
        </>
      )}
    </>
  );
}
