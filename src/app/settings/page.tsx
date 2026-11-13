import { AppNav, Flash } from "@/components/AppNav";
import { requireUser } from "@/lib/auth/user";
import { whatsappConfigured } from "@/lib/whatsapp/send";
import { savePreferences, sendTestAlert } from "./actions";

export const metadata = { title: "Settings · PingDesk" };
export const dynamic = "force-dynamic";

const CATEGORIES: [string, string, string][] = [
  ["buyer_message", "Buyer messages", "Someone sent you a message"],
  ["order_alert", "Orders", "New orders, deliveries, revisions"],
  ["payment_alert", "Payments", "Earnings cleared, withdrawals"],
  ["security_alert", "Security", "Logins, password and verification emails"],
  ["policy_alert", "Policy notices", "Warnings and terms changes"],
  ["other_alert", "Everything else", "Other Fiverr emails"],
];

export default async function Settings({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, user } = await requireUser("/settings");
  const { data: prefs } = await supabase.from("notification_preferences").select("*").eq("user_id", user.id).maybeSingle();
  const p = (prefs ?? {}) as Record<string, unknown>;
  const on = (k: string) => (prefs ? p[k] !== false : k !== "other_alert");
  const zones = Intl.supportedValuesOf("timeZone");
  const tz = (p.timezone as string) || "UTC";
  const number = p.whatsapp_number ? `+${p.whatsapp_number}` : "";

  return (
    <main className="shell">
      <AppNav active="settings" email={user.email} />
      <header className="page-head"><p className="eyebrow">SETTINGS</p><h1 className="h-sm">Where alerts go</h1></header>
      <Flash error={sp.error} notice={sp.notice} />
      {!whatsappConfigured() && <p className="flash warn">WhatsApp sending isn&apos;t set up on the server yet, so alerts will wait in the queue until it is.</p>}

      <form action={savePreferences} className="form card">
        <h2 className="h-xs">WhatsApp</h2>
        <label>WhatsApp number
          <input name="whatsapp_number" type="tel" inputMode="tel" autoComplete="tel" placeholder="+234 803 123 4567" defaultValue={number} />
          <small>Include the country code.</small>
        </label>
        <label className="check"><input type="checkbox" name="whatsapp_opt_in" defaultChecked={Boolean(p.whatsapp_opt_in)} />
          <span>Send me alerts on WhatsApp. <small>I agree to receive automated notification messages at this number and can turn this off any time.</small></span>
        </label>
        <label>Time zone for alert times
          <select name="timezone" defaultValue={tz}>{zones.map((z) => <option key={z} value={z}>{z.replaceAll("_", " ")}</option>)}{!zones.includes("UTC") && <option value="UTC">UTC</option>}</select>
        </label>

        <h2 className="h-xs">Which emails</h2>
        <div className="checks">
          {CATEGORIES.map(([key, label, hint]) => (
            <label key={key} className="check"><input type="checkbox" name={key} defaultChecked={on(key)} /><span>{label}<small>{hint}</small></span></label>
          ))}
        </div>
        <button className="primary" type="submit">Save settings</button>
      </form>

      <section className="card row-between">
        <div><b>Send a test alert</b><p className="muted">Sends one message to your saved number so you can check it arrives.</p></div>
        <form action={sendTestAlert}><button className="outline" type="submit" disabled={!p.whatsapp_opt_in || !p.whatsapp_number}>Send test</button></form>
      </section>
    </main>
  );
}
