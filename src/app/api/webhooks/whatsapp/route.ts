import {NextRequest,NextResponse} from "next/server";
import {createHmac,timingSafeEqual} from "node:crypto";
import {supabaseAdmin} from "@/lib/supabase/admin";
export const runtime="nodejs";
export async function GET(req:NextRequest){
 const mode=req.nextUrl.searchParams.get("hub.mode"),token=req.nextUrl.searchParams.get("hub.verify_token"),challenge=req.nextUrl.searchParams.get("hub.challenge");
 if(mode==="subscribe"&&token&&token===process.env.META_WA_VERIFY_TOKEN&&challenge)return new NextResponse(challenge,{status:200});
 return NextResponse.json({error:"Webhook verification failed."},{status:403});
}
export async function POST(req:NextRequest){
 const raw=await req.text(),signature=req.headers.get("x-hub-signature-256"),secret=process.env.META_WA_APP_SECRET;
 if(!signature||!secret)return NextResponse.json({error:"Webhook signature configuration missing."},{status:401});
 const expected="sha256="+createHmac("sha256",secret).update(raw).digest("hex");
 const a=Buffer.from(signature),b=Buffer.from(expected);if(a.length!==b.length||!timingSafeEqual(a,b))return NextResponse.json({error:"Invalid signature."},{status:401});
 const payload=JSON.parse(raw);
 const statuses=payload.entry?.flatMap((e:any)=>e.changes??[]).flatMap((c:any)=>c.value?.statuses??[])??[];
 for(const s of statuses){
  if(!s.id)continue;
  const status=s.status==="delivered"?"delivered":s.status==="read"?"read":s.status==="sent"?"sent":s.status==="failed"?"failed":null;
  if(status)await supabaseAdmin.from("delivery_logs").update({delivery_status:status,delivered_at:status==="delivered"?new Date(Number(s.timestamp)*1000).toISOString():null,error_code:s.errors?.[0]?.code?.toString()??null}).eq("provider_message_id",s.id);
 }
 return NextResponse.json({received:true});
}
