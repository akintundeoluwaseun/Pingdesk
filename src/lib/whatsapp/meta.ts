/**
 * Meta WhatsApp Cloud API client (official Graph API, template messages only
 * for business-initiated sends).
 */
export type MetaConfig = {
  phoneNumberId: string;
  accessToken: string;
  apiVersion: string; // e.g. v26.0
};

export type TemplateComponent = {
  type: "body" | "button" | "header";
  sub_type?: "url" | "quick_reply";
  index?: string;
  parameters: { type: "text"; text: string }[];
};

export class MetaError extends Error {
  constructor(
    public readonly code: number | null,
    public readonly title: string,
    public readonly retryable: boolean,
    public readonly operator: boolean, // our configuration is wrong (alert the operator)
    public readonly httpStatus: number,
  ) {
    super(`WhatsApp API error ${code ?? httpStatus}: ${title}`);
    this.name = "MetaError";
  }
}

// https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes
const RETRYABLE = new Set([1, 2, 4, 80007, 130429, 131000, 131016, 131048, 131049, 131056, 133004, 133005]);
const OPERATOR = new Set([0, 3, 10, 100, 190, 200, 368, 131008, 131009, 131030, 131031, 131042, 132000, 132001, 132005, 132007, 132012, 132015, 132016, 133010]);

export function classifyMetaError(httpStatus: number, body: unknown): MetaError {
  const err = (body as { error?: { code?: number; error_subcode?: number; message?: string; error_data?: { details?: string } } })?.error;
  const code = typeof err?.code === "number" ? err.code : null;
  const title = (err?.message ?? `HTTP ${httpStatus}`).slice(0, 200);
  const retryable = code !== null ? RETRYABLE.has(code) : httpStatus >= 500 || httpStatus === 429;
  const operator = code !== null && OPERATOR.has(code);
  return new MetaError(code, title, retryable, operator, httpStatus);
}

/** Template parameter text: no newlines/tabs, no runs of spaces, bounded length. */
export function cleanParam(value: string, max = 60): string {
  const v = value.replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim();
  return (v.length > max ? `${v.slice(0, max - 1)}…` : v) || "—";
}

export function metaClient(cfg: MetaConfig, fetchImpl: typeof fetch = fetch) {
  const url = `https://graph.facebook.com/${cfg.apiVersion}/${cfg.phoneNumberId}/messages`;

  async function post(payload: Record<string, unknown>): Promise<{ messageId: string }> {
    let res: Response;
    try {
      res = await fetchImpl(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", ...payload }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new MetaError(null, "Network error reaching WhatsApp API", true, false, 0);
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw classifyMetaError(res.status, body);
    const id = (body as { messages?: { id?: string }[] }).messages?.[0]?.id;
    if (!id) throw new MetaError(null, "WhatsApp API returned no message id", true, false, res.status);
    return { messageId: id };
  }

  return {
    sendTemplate(to: string, name: string, language: string, components: TemplateComponent[]) {
      return post({ to: to.replace(/^\+/, ""), type: "template", template: { name, language: { code: language }, components } });
    },
    /** Free-form text: only valid inside the 24-hour window after the user messaged us. */
    sendText(to: string, body: string) {
      return post({ to: to.replace(/^\+/, ""), type: "text", text: { preview_url: false, body: body.slice(0, 1000) } });
    },
  };
}

export type WhatsAppClient = ReturnType<typeof metaClient>;

/** Authentication (OTP) template with a copy-code button: the code goes in the body and the button. */
export function otpComponents(code: string): TemplateComponent[] {
  return [
    { type: "body", parameters: [{ type: "text", text: code }] },
    { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: code }] },
  ];
}
