import {NextResponse} from "next/server";
import {SignJWT} from "jose";
import {googleOAuthClient,GMAIL_SCOPE} from "@/lib/google/oauth";
export const runtime="nodejs";
export async function GET(){
 const secret=process.env.OAUTH_STATE_SECRET;if(!secret) return NextResponse.json({error:"OAuth state secret is not configured."},{status:500});
 const state=crypto.randomUUID();
 const signed=await new SignJWT({state}).setProtectedHeader({alg:"HS256"}).setIssuedAt().setExpirationTime("10m").sign(new TextEncoder().encode(secret));
 const url=googleOAuthClient().generateAuthUrl({access_type:"offline",prompt:"consent",scope:[GMAIL_SCOPE],state});
 const response=NextResponse.redirect(url);response.cookies.set("pd_oauth_state",signed,{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax",path:"/",maxAge:600});response.cookies.set("pd_oauth_nonce",state,{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax",path:"/",maxAge:600});return response;
}
