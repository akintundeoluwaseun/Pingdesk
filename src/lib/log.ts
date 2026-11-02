/**
 * Structured JSON logger. Never pass tokens, email bodies, phone numbers or
 * message contents. Known-sensitive keys are redacted defensively anyway.
 */
const SENSITIVE = /token|secret|password|authorization|cookie|code|refresh|phone|body|snippet/i;

type Fields = Record<string, unknown>;

function scrub(fields: Fields): Fields {
  const out: Fields = {};
  for (const [k, v] of Object.entries(fields)) {
    if (SENSITIVE.test(k) && !/^error_?code$|^status_?code$/i.test(k)) out[k] = "[redacted]";
    else if (v instanceof Error) out[k] = { name: v.name, message: v.message.slice(0, 300) };
    else out[k] = v;
  }
  return out;
}

function emit(level: "info" | "warn" | "error", event: string, fields: Fields = {}) {
  const line = JSON.stringify({ level, event, at: new Date().toISOString(), ...scrub(fields) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  info: (event: string, fields?: Fields) => emit("info", event, fields),
  warn: (event: string, fields?: Fields) => emit("warn", event, fields),
  error: (event: string, fields?: Fields) => emit("error", event, fields),
};
