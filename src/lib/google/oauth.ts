import { google } from "googleapis";
export const GMAIL_SCOPE="https://www.googleapis.com/auth/gmail.readonly";
export function googleOAuthClient(){
 const {GOOGLE_CLIENT_ID,GOOGLE_CLIENT_SECRET,GOOGLE_REDIRECT_URI}=process.env;
 if(!GOOGLE_CLIENT_ID||!GOOGLE_CLIENT_SECRET||!GOOGLE_REDIRECT_URI)throw new Error("Google OAuth is not configured.");
 return new google.auth.OAuth2(GOOGLE_CLIENT_ID,GOOGLE_CLIENT_SECRET,GOOGLE_REDIRECT_URI);
}
