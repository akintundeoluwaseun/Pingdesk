# PingDesk — implementation scaffold

A cloud-hosted, notification-only email-to-WhatsApp alert service. This repository is a development scaffold; live integrations require your own Google and Meta credentials, provider verification and real sample emails.

## Current implementation
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
- SQL schema with RLS, inboxes, preferences, notifications, jobs and delivery logs

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

Run the SQL in `supabase/schema.sql` in Supabase SQL Editor.

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
