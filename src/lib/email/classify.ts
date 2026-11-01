export type AlertCategory="buyer_message"|"order"|"payment"|"policy"|"security"|"other";
export type Candidate={from:string;subject:string};
const VERIFIED_FIVERR_DOMAINS=(process.env.FIVERR_VERIFIED_SENDER_DOMAINS??"").split(",").map(x=>x.trim().toLowerCase()).filter(Boolean);
export function classifyFiverrEmail(input:Candidate):AlertCategory|null{
 const address=(input.from.match(/<([^>]+)>/)?.[1]??input.from).trim().toLowerCase();
 const domain=address.split("@")[1];
 if(!domain||!VERIFIED_FIVERR_DOMAINS.some(d=>domain===d||domain.endsWith(`.${d}`)))return null;
 const s=input.subject.toLowerCase();
 if(/security|password|login|verification/.test(s))return "security";
 if(/policy|terms|account warning/.test(s))return "policy";
 if(/payment|withdrawal|earnings/.test(s))return "payment";
 if(/order/.test(s))return "order";
 if(/message|inbox/.test(s))return "buyer_message";
 return "other";
}
