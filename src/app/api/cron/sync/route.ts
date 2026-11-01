import {NextRequest,NextResponse} from "next/server";
import {supabaseAdmin} from "@/lib/supabase/admin";
import {decryptSecret} from "@/lib/security/crypto";
import {listRecentMessageIds,getMessageMetadata} from "@/lib/google/gmail";
import {classifyFiverrEmail} from "@/lib/email/classify";
import {fingerprint} from "@/lib/notifications/fingerprint";
export const runtime="nodejs",maxDuration=60;
export async function POST(req:NextRequest){
 const secret=process.env.INTERNAL_CRON_SECRET;if(!secret||req.headers.get("authorization")!==`Bearer ${secret}`)return NextResponse.json({error:"Unauthorized"},{status:401});
 const {data:inboxes,error}=await supabaseAdmin.from("connected_inboxes").select("id,user_id,email_address,display_name,encrypted_refresh_token").eq("status","active").limit(50);
 if(error)return NextResponse.json({error:"Could not load inboxes."},{status:500});
 const results=[];
 for(const inbox of inboxes??[]){
  try{
   const refresh=decryptSecret(inbox.encrypted_refresh_token);
   const ids=await listRecentMessageIds(refresh,Math.floor(Date.now()/1000)-60*60*24);
   let created=0;
   for(const item of ids){
    if(!item.id)continue;
    const meta=await getMessageMetadata(refresh,item.id);
    const category=classifyFiverrEmail({from:meta.from,subject:meta.subject});
    if(!category)continue;
    const fp=fingerprint(inbox.id,item.id);
    const {error:insertError}=await supabaseAdmin.from("notifications").insert({user_id:inbox.user_id,inbox_id:inbox.id,source_message_id:item.id,category,subject:meta.subject,received_at:meta.date?new Date(meta.date).toISOString():null,fingerprint:fp,processing_status:"queued"});
    if(!insertError)created++;
    else if(insertError.code!=="23505")throw insertError;
   }
   results.push({inbox:inbox.email_address,created});
  }catch(e){results.push({inbox:inbox.email_address,error:e instanceof Error?e.message:"sync failed"});}
 }
 return NextResponse.json({processed:results.length,results});
}
