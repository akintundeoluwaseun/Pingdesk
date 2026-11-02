import { getProfile } from "@/server/queries";
import { requireUser } from "@/lib/supabase/server";
import { ErrorPanel, PageHeader } from "@/components/ui";
import { DeleteAccountForm, ProfileForm, RetentionForm } from "./forms";

export const metadata = { title: "Settings — PingDesk" };

export default async function SettingsPage() {
  const user = await requireUser();
  let profile: Awaited<ReturnType<typeof getProfile>>;
  try {
    profile = await getProfile();
  } catch (e) {
    return <ErrorPanel message={e instanceof Error ? e.message : "Unknown error."} />;
  }
  const zones = Intl.supportedValuesOf("timeZone");
  return (
    <>
      <PageHeader eyebrow="ACCOUNT" title="Settings" />
      <section className="panel" aria-labelledby="profile-h">
        <h2 id="profile-h">Profile</h2>
        <ProfileForm fullName={profile?.full_name ?? ""} timezone={profile?.timezone ?? "UTC"} zones={["UTC", ...zones]} email={user.email ?? ""} />
      </section>
      <section className="panel" aria-labelledby="data-h">
        <h2 id="data-h">Data</h2>
        <RetentionForm days={profile?.retention_days ?? 90} />
      </section>
      <section className="panel" aria-labelledby="plan-h">
        <h2 id="plan-h">Plan</h2>
        <p className="muted">PingDesk is in private beta. Billing isn&apos;t enabled, and you won&apos;t be charged.</p>
      </section>
      <section className="panel danger-zone" aria-labelledby="danger-h">
        <h2 id="danger-h">Delete account</h2>
        <p className="muted">
          Revokes PingDesk&apos;s Google access for every inbox and permanently deletes your account, connections and alert history.
        </p>
        <DeleteAccountForm email={user.email ?? ""} />
      </section>
    </>
  );
}
