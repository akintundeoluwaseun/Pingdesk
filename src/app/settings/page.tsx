import { CheckCircle2 } from "lucide-react";
import { AppNav, Flash } from "@/components/AppNav";
import { requireUser } from "@/lib/auth/user";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verificationConfigured, whatsappConfigured } from "@/lib/whatsapp/send";
import { CATEGORY_HINT, CATEGORY_LABEL, type AlertCategory } from "@/lib/email/classify";
import { confirmVerification, savePreferences, sendTestAlert, startVerification, stopWhatsApp } from "./actions";

export const metadata = { title: "Settings · PingDesk" };
export const dynamic = "force-dynamic";

const ORDER: AlertCategory[] = ["new_order", "buyer_message", "order_update", "payment", "account_security", "policy", "general", "unclassified"];

function PhoneForm({ label, defaultValue }: { label: string; defaultValue?: string }) {
  return (
    <form action={startVerification} className="form">
      <label>WhatsApp number
        <input name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="+234 803 123 4567" defaultValue={defaultValue} required />
        <small>Include the country code. We&apos;ll send a 6-digit code to check it&apos;s yours.</small>
      </label>
      <label className="check"><input type="checkbox" name="consent" required />
        <span>Send me PingDesk alerts on WhatsApp. <small>I agree to receive automated notification messages at this number. Reply STOP any time to turn them off.</small></span>
      </label>
      <button className="primary" type="submit">{label}</button>
    </form>
  );
}

export default async function Settings({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, user } = await requireUser("/settings");
  const [{ data: prefs }, { data: profile }, { data: wa }] = await Promise.all([
    supabase.from("notification_preferences").select("*").eq("user_id", user.id).maybeSingle(),
    supabase.from("profiles").select("timezone").eq("id", user.id).maybeSingle(),
    supabaseAdmin.from("whatsapp_connections").select("phone_e164,status,verification_expires_at").eq("user_id", user.id).maybeSingle(),
  ]);
  const p = (prefs ?? {}) as Record<string, unknown>;
  const on = (k: AlertCategory) => (prefs ? p[k] === true : !["general", "unclassified"].includes(k));
  const zones = Intl.supportedValuesOf("timeZone");
  const tz = profile?.timezone || "UTC";
  const pending = wa?.status === "pending_verification" && wa.verification_expires_at && new Date(wa.verification_expires_at) > new Date();

  return (
    <main className="shell">
      <AppNav active="settings" email={user.email} />
      <header className="page-head"><p className="eyebrow">SETTINGS</p><h1 className="h-sm">Where alerts go</h1></header>
      <Flash error={sp.error} notice={sp.notice} />
      {(!whatsappConfigured() || !verificationConfigured()) && <p className="flash warn">WhatsApp sending isn&apos;t fully set up on the server yet, so codes and alerts can&apos;t send until it is.</p>}

      <section className="card">
        <h2 className="h-xs">WhatsApp</h2>
        {wa?.status === "verified" ? (
          <>
            <div className="verified"><CheckCircle2 size={18} /><span><b>{wa.phone_e164}</b> is verified. Alerts go here.</span></div>
            <div className="row-actions">
              <form action={sendTestAlert}><button className="outline" type="submit">Send test alert</button></form>
              <form action={stopWhatsApp}><button className="linkbtn danger" type="submit">Turn off WhatsApp alerts</button></form>
            </div>
            <details className="change"><summary>Use a different number</summary><PhoneForm label="Send code" /></details>
          </>
        ) : pending ? (
          <>
            <p className="muted">We sent a code to <b>{wa.phone_e164}</b> on WhatsApp.</p>
            <form action={confirmVerification} className="form inline">
              <label>6-digit code<input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required /></label>
              <button className="primary" type="submit">Verify</button>
            </form>
            <details className="change"><summary>Resend or change the number</summary><PhoneForm label="Send a new code" defaultValue={wa.phone_e164} /></details>
          </>
        ) : (
          <>
            {wa?.status === "opted_out" && <p className="muted">WhatsApp alerts are off for {wa.phone_e164}. Verify a number to turn them back on.</p>}
            <PhoneForm label="Send code" defaultValue={wa?.phone_e164} />
          </>
        )}
      </section>

      <form action={savePreferences} className="form card">
        <h2 className="h-xs">Alerts</h2>
        <label className="check"><input type="checkbox" name="alerts_paused" defaultChecked={p.alerts_paused === true} />
          <span>Pause all alerts <small>Emails are still recorded on your dashboard, but nothing is sent.</small></span>
        </label>
        <label>Time zone for alert times
          <select name="timezone" defaultValue={tz}>{zones.map((z) => <option key={z} value={z}>{z.replaceAll("_", " ")}</option>)}{!zones.includes("UTC") && <option value="UTC">UTC</option>}</select>
        </label>
        <h2 className="h-xs">Which emails</h2>
        <div className="checks">
          {ORDER.map((k) => (
            <label key={k} className="check"><input type="checkbox" name={k} defaultChecked={on(k)} /><span>{CATEGORY_LABEL[k]}<small>{CATEGORY_HINT[k]}</small></span></label>
          ))}
        </div>
        <button className="primary" type="submit">Save settings</button>
      </form>
    </main>
  );
}
