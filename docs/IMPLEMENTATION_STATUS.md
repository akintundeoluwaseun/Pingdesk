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

## Phase 3 — WhatsApp ✅ (code complete; live Meta run pending)

| Item | State |
|---|---|
| Official Cloud API client (Graph v26.0, configurable), template + in-window text sends | Done — tested with a fake `fetch` |
| Meta error classification: retryable vs permanent vs operator-config | Done — tested |
| Number entry (E.164, Nigerian local format accepted), explicit consent with versioned opt-in | Done — tested |
| One-time-code verification via authentication template; HMAC-stored codes, 10-min expiry, 5-try lock, resend cooldown, per-account and per-number limits | Done — DB functions tested |
| Alert template with metadata only (type, inbox label, local time) | Done — tested |
| Preference enforcement: pause, per-category, verified/opted-in, stale (> 6 h) skip, 30/hour per-user cap | Done — tested |
| Delivery claiming with leases (SKIP LOCKED), atomic attempt recording | Done — tested |
| Retries with exponential backoff (max 6 attempts) incl. failures reported later via webhook | Done — tested |
| Webhook: signature check, statuses never regress, latest-attempt-only, pricing captured | Done — tested |
| STOP / START replies with confirmation | Done — tested |
| WhatsApp page: connect, verify, resend, change, remove, monthly usage | Builds; untested live |
| Setup guide with exact template wording: `docs/WHATSAPP_SETUP.md` | Done |

## Phase 4 — Background processing ✅ (code complete; live scheduler run pending)

| Item | State |
|---|---|
| Durable Postgres job queue: `enqueue_job`, `claim_jobs` (SKIP LOCKED + leases), `complete_job`, `fail_job`, `release_job` | Done — 15 DB tests |
| Restart/crash recovery: expired lease → re-claimed; poison jobs → `dead` | Done — tested |
| Fencing: a worker that lost its lease can't overwrite results | Done — tested |
| Idempotency keys (once ever) + dedupe keys (one active per inbox / notification) | Done — tested |
| Delivery job created by trigger in the same transaction as the notification (rollback-safe) | Done — tested |
| Webhook-reported retryable failures re-queue delivery | Done — tested |
| Workers: `sync_inbox`, `deliver_notification` (idempotent), daily `maintenance` | Done — tested with fakes |
| Worker loop with per-job time budget; unstarted jobs released without using attempts | Done — tested |
| `/api/cron/tick` (and `/api/cron/sync` alias) | Builds; untested live |
| Scheduler: Supabase pg_cron + pg_net every minute (SQL in `docs/SCHEDULER.md`), GitHub Actions backup every 5 min | Written; untested live |
| Fully cloud-based — no dependency on the customer's computer | By design |

## Phase 5 — Finish the product ✅ (code complete)

| Item | State |
|---|---|
| Alert detail page: category, inbox, timestamps, verified sender, skip reason, full delivery timeline per attempt | Done — rendered and checked |
| History rows link to details; filters and pagination | Done |
| Inbox management: "Check now" (queued, 6/hour/inbox), plain-language sync error explanations | Done — DB function tested |
| WhatsApp: "Send test alert" (queued job, 3/day) | Done — tested |
| Activity log (connections, verification, opt-out, preference/profile/password changes, reauth needed) — user-visible, read-only, RLS | Done — tested |
| Data retention setting (30/90/180/365 days) applied by the daily maintenance job; audit kept 1 year | Done — tested |
| Rate limiting (DB fixed-window): Gmail connect, rename, preferences, test alerts, Check now, verification codes | Done — tested |
| Operator status endpoint `GET /api/admin/status` (aggregate counts, 503 when unhealthy — usable by any free uptime monitor) | Done — DB function tested |
| Error boundary, global error page, 404 page, loading skeletons | Done |
| Responsive layouts (desktop / mobile) for all pages | Checked with screenshots |

## Phase 6 — Test and deploy (next)
- [ ] Live Supabase project: apply migrations, auth flow end to end
- [ ] Live Gmail test with a test user
- [ ] Live WhatsApp test with approved templates
- [ ] Security review (endpoints, RLS, secrets, headers/CSP)
- [ ] Hosting choice for a commercial product + deployment guide

## External requirements still open
- Supabase project for PingDesk (none exists yet)
- Google Cloud OAuth client; Gmail `readonly` is a restricted scope → test users only until Google verification/security assessment
- Meta Business + WhatsApp Cloud API app, phone number, System User token, **approved alert (utility) and verification (authentication) templates** — see `docs/WHATSAPP_SETUP.md`
- Real Fiverr samples for **new order, order update/delivery and payment** emails (from an active seller account)

## Known interim pieces
- Delivery is at-least-once: a crash between Meta accepting a message and PingDesk recording it can cause a duplicate alert.
- Vercel's free (Hobby) plan is for non-commercial use; choose hosting for a paid product in Phase 6.
