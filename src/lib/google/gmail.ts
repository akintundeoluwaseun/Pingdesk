import { google } from "googleapis";
import { googleOAuthClient } from "./oauth";
export function gmailClient(refreshToken:string){
 const auth=googleOAuthClient();auth.setCredentials({refresh_token:refreshToken});
 return google.gmail({version:"v1",auth});
}
export async function listRecentMessageIds(refreshToken:string,afterEpochSeconds:number){
 const gmail=gmailClient(refreshToken);
 const response=await gmail.users.messages.list({userId:"me",q:`after:${afterEpochSeconds}`,maxResults:50});
 return response.data.messages??[];
}
export async function getMessageMetadata(refreshToken:string,messageId:string){
 const gmail=gmailClient(refreshToken);
 const response=await gmail.users.messages.get({userId:"me",id:messageId,format:"metadata",metadataHeaders:["From","Subject","Date","Message-ID"]});
 const headers=response.data.payload?.headers??[];
 const read=(name:string)=>headers.find(h=>h.name?.toLowerCase()===name.toLowerCase())?.value??"";
 return {id:messageId,from:read("From"),subject:read("Subject"),date:read("Date"),internalDate:response.data.internalDate??null};
}
