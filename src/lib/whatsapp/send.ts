export class WhatsAppError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); }
}

/** Sends the approved alert template. Body variables: {{1}} account, {{2}} category, {{3}} time. */
export async function sendAlertTemplate(to: string, accountLabel: string, category: string, receivedAt: string) {
  const phoneId = process.env.META_WA_PHONE_NUMBER_ID, token = process.env.META_WA_ACCESS_TOKEN, template = process.env.META_WA_TEMPLATE_ALERT;
  if (!phoneId || !token || !template) throw new WhatsAppError("Meta WhatsApp Cloud API is not configured.", 0, "not_configured");
  const response = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp", to, type: "template",
      template: {
        name: template,
        language: { code: process.env.META_WA_TEMPLATE_LANGUAGE ?? "en" },
        components: [{ type: "body", parameters: [{ type: "text", text: accountLabel }, { type: "text", text: category }, { type: "text", text: receivedAt }] }],
      },
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = data?.error;
    throw new WhatsAppError(err?.message ?? `WhatsApp API ${response.status}`, response.status, err?.code?.toString());
  }
  return { messageId: (data?.messages?.[0]?.id as string | undefined) ?? null };
}

export function whatsappConfigured() {
  return Boolean(process.env.META_WA_PHONE_NUMBER_ID && process.env.META_WA_ACCESS_TOKEN && process.env.META_WA_TEMPLATE_ALERT);
}
