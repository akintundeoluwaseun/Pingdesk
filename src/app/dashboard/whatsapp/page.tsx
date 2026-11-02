import { MessageCircle, ShieldCheck } from "lucide-react";
import { getWhatsApp, getMonthlyUsage } from "@/server/queries";
import { isConfigured } from "@/lib/env";
import { EmptyState, ErrorPanel, PageHeader, formatDateTime } from "@/components/ui";
import { ChangeNumber, CodeForm, PhoneForm, RemoveNumber, TestAlertButton } from "./forms";

export const metadata = { title: "WhatsApp — PingDesk" };

export default async function WhatsAppPage() {
  let wa: Awaited<ReturnType<typeof getWhatsApp>>;
  let usage = 0;
  try {
    [wa, usage] = await Promise.all([getWhatsApp(), getMonthlyUsage()]);
  } catch (e) {
    return <ErrorPanel message={e instanceof Error ? e.message : "Unknown error."} />;
  }
  const ready = isConfigured("whatsapp");

  return (
    <>
      <PageHeader
        eyebrow="DELIVERY"
        title="WhatsApp"
        description="Alerts come from PingDesk's official WhatsApp Business number. They say what happened and when — never the message contents — and point you back to Fiverr."
      />

      {!ready ? (
        <EmptyState
          icon={<MessageCircle size={20} />}
          title="WhatsApp delivery isn't available yet"
          body="PingDesk's WhatsApp Business sender is still awaiting setup and Meta template approval. Your alerts are being recorded in History in the meantime."
        />
      ) : !wa ? (
        <section className="panel">
          <h2>Connect your WhatsApp</h2>
          <PhoneForm />
        </section>
      ) : wa.status === "pending_verification" ? (
        <section className="panel">
          <h2>Enter your code</h2>
          <CodeForm phoneLast4={wa.phone_e164.slice(-4)} />
        </section>
      ) : (
        <section className="panel">
          <div className="list-row">
            <MessageCircle size={18} aria-hidden />
            <div className="grow">
              <b>WhatsApp ending {wa.phone_e164.slice(-4)}</b>
              <small>
                {wa.status === "verified" && wa.verified_at
                  ? `Verified ${formatDateTime(wa.verified_at)}`
                  : "You replied STOP, so alerts are paused. Reply START on WhatsApp to turn them back on."}
              </small>
            </div>
            <span className={`badge badge-${wa.status === "verified" ? "success" : "muted"}`}>{wa.status === "verified" ? "Verified" : "Stopped"}</span>
          </div>
          <dl className="meta wa-meta">
            <div>
              <dt>Alerts sent this month</dt>
              <dd>{usage.toLocaleString()}</dd>
            </div>
          </dl>
          <div className="card-actions">
            {wa.status === "verified" ? <TestAlertButton /> : null}
            <ChangeNumber />
            <RemoveNumber />
          </div>
        </section>
      )}

      <section className="panel subtle">
        <div className="list-row">
          <ShieldCheck size={18} aria-hidden />
          <div className="grow">
            <b>How consent works</b>
            <small>
              You opt in on this page and confirm the number with a one-time code. Reply STOP on WhatsApp or remove the number here to stop
              alerts at any time.
            </small>
          </div>
        </div>
      </section>
    </>
  );
}
