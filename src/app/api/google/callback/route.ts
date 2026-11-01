import {NextRequest,NextResponse} from "next/server";
import {jwtVerify} from "jose";
import {googleOAuthClient} from "@/lib/google/oauth";
import {supabaseServer} from "@/lib/supabase/server";
import {supabaseAdmin} from "@/lib/supabase/admin";
import {encryptSecret} from "@/lib/security/crypto";
export const runtime="nodejs";
export async function GET(req:NextRequest){
 const code=req.nextUrl.searchParams.get("code"),state=req.nextUrl.searchParams.get("state"),signed=req.cookies.get("pd_oauth_state")?.value,nonce=req.cookies.get("pd_oauth_nonce")?.value,secret=process.env.OAUTH_STATE_SECRET;
 const fail=(message:string,status=400)=>NextResponse.json({error:message},{status});
 if(!code||!state||!signed||!nonce||!secret)return fail("OAuth response is incomplete.");
 try{const verified=await jwtVerify(signed,new TextEncoder().encode(secret));if(verified.payload.state!==nonce||state!==nonce) return fail("OAuth state validation failed.");}catch{return fail("OAuth state validation failed.");}
 const supabase=await supabaseServer();const {data:{user}}=await supabase.auth.getUser();if(!user)return fail("Sign in to PingDesk before connecting Gmail.",401);
 try{
  const oauth=googleOAuthClient();const {tokens}=await oauth.getToken(code);if(!tokens.refresh_token) return fail("Google did not return a refresh token. Revoke the existing grant and reconnect with consent.");
  oauth.setCredentials(tokens);const {google}=await import("googleapis");const gmail=google.gmail({version:"v1",auth:oauth});const profile=await gmail.users.getProfile({userId:"me"});
  const email=profile.data.emailAddress;if(!email)return fail("Could not identify the Gmail address.");
  const {error}=await supabaseAdmin.from("connected_inboxes").upsert({user_id:user.id,provider:"gmail",email_address:email,display_name:email,encrypted_refresh_token:encryptSecret(tokens.refresh_token),status:"active"},{onConflict:"user_id,provider,email_address"});
  if(error)throw error;
  const response=NextResponse.redirect(new URL("/",req.url));response.cookies.delete("pd_oauth_state");response.cookies.delete("pd_oauth_nonce");return response;
 }catch(e){return fail(e instanceof Error?e.message:"Google connection failed.",500);}
}
