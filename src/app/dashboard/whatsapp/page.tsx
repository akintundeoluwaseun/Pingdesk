import { MessageCircle, ShieldCheck } from "lucide-react";
import { getWhatsApp } from "@/server/queries";
import { isConfigured } from "@/lib/env";
import { EmptyState, ErrorPanel, PageHeader, formatDateTime } from "@/components/ui";

export const metadata = { title: "WhatsApp — PingDesk" };

export default async function WhatsAppPage() {
  let wa: Awaited<ReturnType<typeof getWhatsApp>>;
  try {
    wa = await getWhatsApp();
  } catch (e) {
    return <ErrorPanel message={e instanceof Error ? e.message : "Unknown error."} />;
  }
  const senderReady = isConfigured("whatsapp");

  return (
    <>
      <PageHeader
        eyebrow="DELIVERY"
        title="WhatsApp"
        description="Alerts are sent from PingDesk's official WhatsApp Business number to a number you verify. Alerts say what happened and link you back to Fiverr — message contents are never forwarded."
      />
      {wa ? (
        <section className="panel">
          <div className="list-row">
            <MessageCircle size={18} aria-hidden />
            <div className="grow">
              <b>Number ending {wa.phone_e164.slice(-4)}</b>
              <small>
                {wa.status === "verified" && wa.verified_at
                  ? `Verified ${formatDateTime(wa.verified_at)}`
                  : wa.status === "opted_out"
                    ? "You opted out. No alerts are sent."
                    : "Waiting for verification"}
              </small>
            </div>
            <span className={`badge badge-${wa.status === "verified" ? "success" : wa.status === "opted_out" ? "muted" : "warning"}`}>
              {wa.status === "verified" ? "Verified" : wa.status === "opted_out" ? "Opted out" : "Pending"}
            </span>
          </div>
        </section>
      ) : (
        <EmptyState
          icon={<MessageCircle size={20} />}
          title="No WhatsApp number yet"
          body={
            senderReady
              ? "Number verification is being finalised and will appear here shortly."
              : "WhatsApp delivery isn't available yet: PingDesk's WhatsApp Business sender is still awaiting setup and Meta template approval."
          }
        />
      )}
      <section className="panel subtle">
        <div className="list-row">
          <ShieldCheck size={18} aria-hidden />
          <div className="grow">
            <b>How consent works</b>
            <small>
              You opt in explicitly, confirm the number with a one-time code, and can reply STOP or remove the number any time. WhatsApp
              business messages may be billed per message by Meta.
            </small>
          </div>
        </div>
      </section>
    </>
  );
}
