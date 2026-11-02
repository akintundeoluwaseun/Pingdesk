import { SignJWT, jwtVerify } from "jose";

/**
 * OAuth `state` handling. The browser receives a random nonce as `state`
 * and an httpOnly cookie holding a signed JWT that binds that nonce to the
 * PingDesk user who started the flow. The callback accepts the response only
 * if the nonce matches, the JWT is valid and unexpired, and the signed-in user
 * is the same user. This blocks CSRF and inbox-linking to the wrong account.
 */
export const STATE_COOKIE = "pd_oauth_state";
const AUDIENCE = "pingdesk:google-oauth";

export async function createOAuthState(userId: string, secret: string) {
  const nonce = crypto.randomUUID();
  const cookie = await new SignJWT({ nonce })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(new TextEncoder().encode(secret));
  return { nonce, cookie };
}

export async function verifyOAuthState(input: {
  cookie: string | undefined;
  returnedState: string | null;
  userId: string;
  secret: string;
}): Promise<boolean> {
  if (!input.cookie || !input.returnedState) return false;
  try {
    const { payload } = await jwtVerify(input.cookie, new TextEncoder().encode(input.secret), {
      audience: AUDIENCE,
      algorithms: ["HS256"],
    });
    return payload.nonce === input.returnedState && payload.sub === input.userId;
  } catch {
    return false;
  }
}
