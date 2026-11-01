import "server-only";
import { z } from "zod";

/**
 * Server-side configuration. Values are validated lazily so that a missing
 * optional integration (e.g. WhatsApp) never crashes unrelated pages; each
 * integration asks for its own block and gets a clear error if unconfigured.
 */
const core = z.object({
  NEXT_PUBLIC_APP_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});

const google = z.object({
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_REDIRECT_URI: z.url(),
  OAUTH_STATE_SECRET: z.string().min(32, "OAUTH_STATE_SECRET must be at least 32 characters"),
});

const whatsapp = z.object({
  META_WA_PHONE_NUMBER_ID: z.string().min(1),
  META_WA_ACCESS_TOKEN: z.string().min(1),
  META_WA_VERIFY_TOKEN: z.string().min(16),
  META_WA_APP_SECRET: z.string().min(1),
  META_WA_TEMPLATE_ALERT: z.string().min(1),
  META_WA_TEMPLATE_VERIFY: z.string().min(1),
  META_WA_TEMPLATE_LANGUAGE: z.string().min(2).default("en"),
  META_WA_API_VERSION: z.string().regex(/^v\d+\.\d+$/).default("v26.0"),
});

export class ConfigError extends Error {
  constructor(public readonly area: string, issues: string[]) {
    super(`${area} is not configured: ${issues.join("; ")}`);
    this.name = "ConfigError";
  }
}

function load<T extends z.ZodType>(area: string, schema: T): z.infer<T> {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    // Only variable names are reported, never values.
    throw new ConfigError(area, parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  }
  return parsed.data;
}

export const coreEnv = () => load("Core", core);
export const googleEnv = () => load("Google OAuth", google);
export const whatsappEnv = () => load("WhatsApp Cloud API", whatsapp);

export function isConfigured(area: "google" | "whatsapp") {
  return (area === "google" ? google : whatsapp).safeParse(process.env).success;
}
