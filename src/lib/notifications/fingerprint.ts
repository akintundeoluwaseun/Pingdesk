import {createHash} from "node:crypto";
export function fingerprint(inboxId:string,messageId:string){return createHash("sha256").update(`${inboxId}:${messageId}`).digest("hex");}
