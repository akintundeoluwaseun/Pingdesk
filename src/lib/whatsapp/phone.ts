import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

/**
 * Normalises user input to E.164 (+2348012345678). Accepts international
 * format, or a local number with the chosen default country (e.g. 0803… + NG).
 * Returns null for anything that isn't a valid mobile-capable number.
 */
export function toE164(input: string, defaultCountry: CountryCode = "NG"): string | null {
  const cleaned = input.replace(/[^\d+]/g, "");
  if (cleaned.length < 6 || cleaned.length > 18) return null;
  const parsed = parsePhoneNumberFromString(cleaned.startsWith("00") ? `+${cleaned.slice(2)}` : cleaned, defaultCountry);
  if (!parsed || !parsed.isValid()) return null;
  const type = parsed.getType();
  if (type && !["MOBILE", "FIXED_LINE_OR_MOBILE"].includes(type)) return null;
  return parsed.number; // E.164
}

/** WhatsApp "wa_id" values arrive without the leading "+". */
export function fromWaId(waId: string): string | null {
  return /^[1-9]\d{7,14}$/.test(waId) ? `+${waId}` : null;
}

export const last4 = (e164: string) => e164.slice(-4);
