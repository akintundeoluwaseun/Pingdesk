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

## Phase 2 — Gmail ✅ (code complete; live Google run pending)

| Item | State |
|---|---|
| Incremental sync from Gmail `historyId`, paginated, cursor saved only after processing | Done — tested with a fake Gmail |
| First-connect bootstrap (cursor taken *before* searching, 2-day lookback) | Done — tested |
| Expired-cursor (404) recovery with 7-day search + fresh cursor | Done — tested |
| Reconciliation search every 6 h (sender-restricted query) | Done — tested |
| Per-run cap with resume from last complete history record | Done — tested |
| Spam/trash/draft/sent skipped | Done — tested |
| Revoked access → inbox `needs_reauth`; transient errors counted, back-off, `error` after 5 | Done — DB functions tested |
| Inbox leases (`claim_inboxes_for_sync`, SKIP LOCKED) so overlapping runs never double-sync | Done — tested |
| Sender verification from Gmail's own `Authentication-Results` (first header only, mx.google.com, DMARC pass + aligned DKIM) | Done — tested incl. forged-header, misaligned-DKIM, lookalike, display-name attacks |
| Rules derived from **5 real Fiverr emails** (redacted fixtures in `tests/fixtures/fiverr/`) | Done |
| Configurable rules (`FIVERR_EXTRA_RULES`, `FIVERR_VERIFIED_SENDER_DOMAINS`) | Done — tested |
| `/api/cron/sync` uses the new engine (GET/POST, bearer secret) | Builds; untested live |

**Observed sender:** `noreply@e.fiverr.com` (transactional). `announce.fiverr.com` is marketing and is ignored.
**Recognised subjects:** buyer messages, password reset, phone number added, selling eligibility. **No real samples yet for new order, order update or payment** — those arrive as *Unclassified* until samples are added.

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
- Real Fiverr samples for **new order, order update/delivery and payment** emails (from an active seller account)

## Known interim pieces
- Sync is triggered by calling `/api/cron/sync`; Phase 4 moves work onto the durable job queue and sets up the free scheduler.
