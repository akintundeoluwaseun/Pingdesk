export async function sendAlertTemplate(to:string,accountLabel:string,category:string,receivedAt:string){
 const phoneId=process.env.META_WA_PHONE_NUMBER_ID,token=process.env.META_WA_ACCESS_TOKEN,template=process.env.META_WA_TEMPLATE_ALERT;
 if(!phoneId||!token||!template)throw new Error("Meta WhatsApp Cloud API is not configured.");
 const response=await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`,{
  method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},
  body:JSON.stringify({messaging_product:"whatsapp",to,type:"template",template:{name:template,language:{code:process.env.META_WA_TEMPLATE_LANGUAGE??"en"},components:[{type:"body",parameters:[{type:"text",text:accountLabel},{type:"text",text:category.replaceAll("_"," ")},{type:"text",text:receivedAt}]}]}})
 });
 const data=await response.json();if(!response.ok)throw new Error(`WhatsApp API ${response.status}: ${JSON.stringify(data)}`);return data;
}
