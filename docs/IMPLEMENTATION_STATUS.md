# Implementation status

Legend: **Done** = implemented and covered by automated tests or a production build. **Untested live** = code is complete but has not yet been run against the real external service.

## Phase 1 — Foundation ✅ (code complete; live Supabase run pending)

| Item | State |
|---|---|
| Database migrations (`supabase/migrations/`) — profiles, inboxes, credentials, preferences, WhatsApp, notifications, delivery logs, jobs | Done — tested on Postgres 18 (PGlite) with a Supabase role/auth shim |
| Row Level Security + column-level grants | Done — 13 isolation tests (cross-user reads/writes, token secrecy, anon denied) |
| Refresh tokens moved to service-role-only `inbox_credentials` table | Done |
| Atomic `link_gmail_inbox` / `disconnect_inbox` functions (service role only) | Done — 7 tests |
| AES-256-GCM token encryption with key versioning/rotation, legacy format support | Done — 6 tests |
| OAuth state bound to the signed-in user (CSRF + account-mix-up protection) | Done — 3 tests |
| Supabase email/password auth: register, login, logout, forgot/reset password, email confirm | Untested live |
| Session refresh + `/dashboard` protection (`src/proxy.ts`) + per-page `requireUser()` | Untested live |
| Dashboard: overview (real counts), inboxes (connect/rename/disconnect/remove), WhatsApp status, history (filters + pagination), preferences, settings (profile, time zone, delete account) | Builds; untested live |
| Google token revocation on disconnect and account deletion | Done (unit) / untested live |
| Upgraded to Next.js 16.4, Zod 4.6 (fixes high-severity advisories) | Done |

## Phase 2 — Gmail (next)
- [ ] Replace 24-hour lookback with `historyId` incremental sync + pagination
- [ ] Reconciliation pass and `historyId` expiry (404) recovery
- [ ] Mark inboxes `needs_reauth` on `invalid_grant`
- [ ] Configurable parser rules + SPF/DKIM/DMARC evidence from `Authentication-Results`
- [ ] Fixture tests from **real, redacted Fiverr emails (needed from you)**

## Phase 3 — WhatsApp
- [ ] Number entry, opt-in consent, one-time-code verification
- [ ] Approved template delivery, STOP handling, 24-hour window tracking
- [ ] Webhook replay protection and usage/pricing capture (status ordering already fixed)

## Phase 4 — Background processing
- [ ] Queue functions (claim with `SKIP LOCKED` + leases, backoff, dead-letter) on the existing `jobs` table
- [ ] Sync and delivery workers, scheduler (free tier: Supabase `pg_cron` + `pg_net`, or GitHub Actions cron)

## Phase 5–6
- [ ] Operational log view, retention job, app-level rate limiting
- [ ] Live Gmail + WhatsApp tests, security review, deployment guide

## External requirements still open
- Supabase project for PingDesk (none exists yet)
- Google Cloud OAuth client; Gmail `readonly` is a restricted scope → test users only until Google verification/security assessment
- Meta Business + WhatsApp Cloud API app, phone number, **approved utility template**
- Real, redacted Fiverr notification samples (headers + subject; bodies can be removed)

## Known interim pieces
- `/api/cron/sync` is still the original 24-hour lookback pilot, updated only for the new schema. Phase 2 replaces it.
- The classifier's subject keywords are placeholders until real samples are reviewed. With `FIVERR_VERIFIED_SENDER_DOMAINS` empty, nothing is detected.
