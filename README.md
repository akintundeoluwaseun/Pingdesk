# PingDesk — implementation scaffold

A cloud-hosted, notification-only email-to-WhatsApp alert service. This repository is a development scaffold; live integrations require your own Google and Meta credentials, provider verification and real sample emails.

## Current implementation
- Sign up / sign in with Supabase Auth (email + password), session middleware, protected pages
- Dashboard: setup checklist, connected inboxes with sync status, recent alerts with delivery status, disconnect (revokes the Google token)
- Settings: WhatsApp number verified with a 6-digit code, pause switch, time zone, per-category toggles, test alert; STOP/START replies handled
- Gmail sync by `historyId` (falls back to a 24-hour window on first run or expired history), marks inboxes `needs_reauth` on revoked tokens
- Sender check against `FIVERR_VERIFIED_SENDER_DOMAINS` plus DKIM/DMARC from Gmail's `Authentication-Results`
- Delivery worker: claims queued alerts, honours opt-in and categories, logs every attempt, retries rate limits and server errors (up to 4 attempts)
- WhatsApp status webhook that only moves a delivery forward (sent → delivered → read)
- `/api/cron/sync` (sync + deliver) and `/api/cron/deliver`, plus a GitHub Actions schedule every 5 minutes
- Next.js dashboard shell
- Supabase server and service clients
- Google OAuth start/callback routes with signed state cookie
- Gmail API client for history/list/get operations
- AES-256-GCM token encryption helper
- Conservative sender verification + rule-based category parser (intentionally no assumed Fiverr sender domains)
- Notification fingerprinting
- Meta WhatsApp Cloud API template sender
- WhatsApp webhook verification/status receiver
- Protected internal sync route
- Database functions in Supabase for leasing inboxes and alerts, so overlapping runs never double-send

## Not production-ready yet
- Google OAuth app verification / restricted-scope security assessment may be required for public launch.
- Gmail sender domains and parser patterns must be verified against authorized, redacted Fiverr notification samples.
- The internal sync endpoint is a foundation, not a deployed always-on worker. Deploy a scheduled worker/cron and durable job runner.
- Meta templates must be created and approved; opt-in and pricing apply.
- Add production rate limiting, observability, retention jobs, account deletion and security review.

## Requirements
Node.js 20+, npm, Supabase project, Google Cloud project and Meta developer/business setup.

## Local setup
1. `cp .env.example .env.local`
2. Fill in Supabase, Google and Meta values.
3. `npm install`
4. `npm run dev`

The database is already set up in the **Animora** Supabase project. There is no SQL to run. See `supabase/README.md`.

In Supabase → Authentication → URL Configuration, set the Site URL to your app URL and add `<app-url>/auth/callback` to the redirect URLs (used by the email confirmation link).

## Running the sync
`POST /api/cron/sync` with `Authorization: Bearer $INTERNAL_CRON_SECRET` checks every active inbox and sends due alerts. Schedule it every few minutes with any of:
- the included GitHub Actions workflow (set repo secrets `PINGDESK_URL` and `INTERNAL_CRON_SECRET`)
- cron-job.org or another external scheduler
- Vercel Cron (Hobby plans only allow daily runs, so use one of the above there)

## WhatsApp templates
1. **Verification** (category *Authentication*, with a "Copy code" button). Put its name in `META_WA_TEMPLATE_VERIFY`.
2. **Alert** (category *Utility*) with three body variables. Put its name in `META_WA_TEMPLATE_ALERT`. For example:
`New {{2}} in {{1}} at {{3}}. Open Fiverr to view it.`
{{1}} is the inbox address, {{2}} the category ("Order update"), {{3}} the time in the user's time zone.

## Google OAuth
Create a Web OAuth client. Add the exact redirect URI:
`http://localhost:3000/api/google/callback`

Use the minimum Gmail scope needed for reading notifications. Gmail read access can trigger Google's restricted-scope verification and security assessment requirements for public apps. Start with test users only.

## Meta WhatsApp
Configure a WhatsApp Cloud API app and a pre-approved utility template. Set `META_WA_TEMPLATE_ALERT` to its exact template name. Set webhook callback URL to `/api/webhooks/whatsapp` and verify token to `META_WA_VERIFY_TOKEN`.

## Security notes
- Never ask for Gmail passwords.
- Do not commit `.env.local`.
- Use a 32-byte random `TOKEN_ENCRYPTION_KEY` encoded as 64 hex characters.
- Do not store raw email bodies or forward buyer message contents in this MVP.
- Do not scrape Fiverr, automate Fiverr login or access unofficial Fiverr APIs.
- Configure verified sender domains only after inspecting real, authorized email samples.
