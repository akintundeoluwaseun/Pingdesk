# PingDesk

Cloud-hosted, notification-only bridge that watches an authorized Gmail inbox for Fiverr notification emails and sends a WhatsApp alert through the official Meta WhatsApp Cloud API. Runs entirely in the cloud — the customer's computer can be off.

PingDesk never asks for Gmail or Fiverr passwords, never scrapes Fiverr, and never forwards buyer message contents.

See **[docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md)** for exactly what is done, tested, and still pending.

## Stack
Next.js 16 (App Router, TypeScript) · Supabase (Postgres, Auth, RLS) · Google Gmail API (read-only) · Meta WhatsApp Cloud API · Zod · Vitest + PGlite

## Layout
```
src/app/(auth)/        login, register, forgot/reset password + server actions
src/app/auth/          email-link confirm, sign-out
src/app/dashboard/     overview, inboxes, whatsapp, history, preferences, settings
src/app/api/           google oauth, cron sync, whatsapp webhook
src/server/gmail/      sync engine, Google adapter, run loop
src/server/delivery/   preference checks and retry policy
src/server/jobs/       queue worker, job handlers, tick runtime
src/server/whatsapp/   verification codes, webhook parsing
src/lib/               env, supabase clients, crypto, oauth-state, gmail, classifier, logger
src/server/queries.ts  dashboard reads (always via the user's session → RLS)
src/proxy.ts           session refresh + /dashboard guard
supabase/migrations/   schema, RLS, grants, inbox functions
tests/db/              RLS + function tests against real Postgres (PGlite)
tests/unit/            crypto, OAuth state, classifier, redirects
```

## Local setup
1. Node.js 20+ (`node -v`).
2. `npm install`
3. `cp .env.example .env.local` and fill in the core values (see comments in the file).
4. Create a Supabase project, then apply the migrations in order — either `supabase db push` with the Supabase CLI, or paste each file from `supabase/migrations/` into the SQL editor.
5. In Supabase **Authentication → URL configuration**: set Site URL to your app URL and add `http://localhost:3000/auth/confirm` (and the production equivalent) to Redirect URLs.
6. Recommended: in **Authentication → Email templates**, change the confirm-signup link to
   `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/dashboard`
   and the reset-password link to
   `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password`
   so links work even when opened on a different device. The default links also work in the same browser.
7. `npm run dev`

## Scripts
| | |
|---|---|
| `npm run dev` | dev server |
| `npm run build` | production build |
| `npm run typecheck` | TypeScript |
| `npm run lint` | ESLint |
| `npm test` | unit + database tests (no external services needed) |

## Google OAuth
Create a **Web** OAuth client in Google Cloud, enable the Gmail API, and add the redirect URI exactly:
`http://localhost:3000/api/google/callback` (plus your production URL). PingDesk requests only `gmail.readonly`. That is a restricted scope: keep the app in **Testing** with named test users until Google verification (and possibly a security assessment) is complete.

## Background processing
`/api/cron/tick` (GET or POST, `Authorization: Bearer $INTERNAL_CRON_SECRET`) enqueues due Gmail syncs and works the durable Postgres job queue (sync → detect → deliver). Schedule it every minute with Supabase pg_cron — see **[docs/SCHEDULER.md](docs/SCHEDULER.md)**. A GitHub Actions backup is in `.github/workflows/tick.yml`.

Fiverr detection rules live in `src/lib/email/fiverr-rules.ts` and must be backed by a real, redacted fixture in `tests/fixtures/fiverr/`.

## Meta WhatsApp
See **[docs/WHATSAPP_SETUP.md](docs/WHATSAPP_SETUP.md)** — templates to submit (exact wording), env vars, webhook, retry/opt-out behaviour and costs. Delivery runs as `deliver_notification` jobs.

## Security model
- Browser roles can only `SELECT` their own rows and update whitelisted columns (inbox label, preferences, profile). Everything else goes through server code.
- Refresh tokens live in `inbox_credentials`, readable only by the service role, encrypted with AES-256-GCM (versioned keys).
- OAuth `state` is a signed, 10-minute JWT bound to the signed-in user.
- Logs are structured JSON with sensitive keys redacted; no tokens, email bodies or phone numbers.
- Do not commit `.env.local`.
