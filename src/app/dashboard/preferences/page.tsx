import { getPreferences } from "@/server/queries";
import { ErrorPanel, PageHeader } from "@/components/ui";
import { PreferencesForm } from "./form";

export const metadata = { title: "Preferences — PingDesk" };

export default async function PreferencesPage() {
  let prefs: Awaited<ReturnType<typeof getPreferences>>;
  try {
    prefs = await getPreferences();
  } catch (e) {
    return <ErrorPanel message={e instanceof Error ? e.message : "Unknown error."} />;
  }
  if (!prefs) return <ErrorPanel message="Your preferences record is missing." />;
  return (
    <>
      <PageHeader
        eyebrow="ALERTS"
        title="Notification preferences"
        description="Choose which Fiverr notifications reach WhatsApp. Everything detected is still kept in your history."
      />
      <PreferencesForm prefs={prefs} />
    </>
  );
}
