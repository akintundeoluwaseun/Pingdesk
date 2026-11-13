import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomInt } from "node:crypto";
function key(){const raw=process.env.TOKEN_ENCRYPTION_KEY;if(!raw||!/^[0-9a-fA-F]{64}$/.test(raw))throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes encoded as 64 hex characters.");return Buffer.from(raw,"hex");}
export function encryptSecret(value:string){const iv=randomBytes(12);const cipher=createCipheriv("aes-256-gcm",key(),iv);const encrypted=Buffer.concat([cipher.update(value,"utf8"),cipher.final()]);return [iv.toString("hex"),cipher.getAuthTag().toString("hex"),encrypted.toString("hex")].join(":");}
export function decryptSecret(value:string){const [iv,tag,data]=value.split(":");if(!iv||!tag||!data)throw new Error("Invalid encrypted secret.");const decipher=createDecipheriv("aes-256-gcm",key(),Buffer.from(iv,"hex"));decipher.setAuthTag(Buffer.from(tag,"hex"));return Buffer.concat([decipher.update(Buffer.from(data,"hex")),decipher.final()]).toString("utf8");}

/** One-way hash of a WhatsApp verification code, bound to the user, keyed with the server secret. */
export function hashVerificationCode(userId: string, code: string) {
  return createHmac("sha256", key()).update(`${userId}:${code}`).digest("hex");
}
export function newVerificationCode() {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}
