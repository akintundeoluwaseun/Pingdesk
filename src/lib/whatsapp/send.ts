export class WhatsAppError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); }
}

type Component = Record<string, unknown>;

async function sendTemplate(to: string, template: string, components: Component[]) {
  const phoneId = process.env.META_WA_PHONE_NUMBER_ID, token = process.env.META_WA_ACCESS_TOKEN;
  if (!phoneId || !token || !template) throw new WhatsAppError("Meta WhatsApp Cloud API is not configured.", 0, "not_configured");
  const response = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp", to: to.replace(/^\+/, ""), type: "template",
      template: { name: template, language: { code: process.env.META_WA_TEMPLATE_LANGUAGE ?? "en" }, components },
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = data?.error;
    throw new WhatsAppError(err?.message ?? `WhatsApp API ${response.status}`, response.status, err?.code?.toString());
  }
  return { messageId: (data?.messages?.[0]?.id as string | undefined) ?? null };
}

const text = (t: string) => ({ type: "text", text: t });

/** Utility template META_WA_TEMPLATE_ALERT. Body variables: {{1}} inbox, {{2}} category, {{3}} time. */
export function sendAlertTemplate(to: string, inboxLabel: string, category: string, receivedAt: string) {
  return sendTemplate(to, process.env.META_WA_TEMPLATE_ALERT ?? "", [{ type: "body", parameters: [text(inboxLabel), text(category), text(receivedAt)] }]);
}

/** Authentication template META_WA_TEMPLATE_VERIFY with a copy-code button. Body {{1}} is the code. */
export function sendVerificationCode(to: string, code: string) {
  return sendTemplate(to, process.env.META_WA_TEMPLATE_VERIFY ?? "", [
    { type: "body", parameters: [text(code)] },
    { type: "button", sub_type: "url", index: "0", parameters: [text(code)] },
  ]);
}

export function whatsappConfigured() {
  return Boolean(process.env.META_WA_PHONE_NUMBER_ID && process.env.META_WA_ACCESS_TOKEN && process.env.META_WA_TEMPLATE_ALERT);
}
export function verificationConfigured() {
  return Boolean(process.env.META_WA_PHONE_NUMBER_ID && process.env.META_WA_ACCESS_TOKEN && process.env.META_WA_TEMPLATE_VERIFY);
}
