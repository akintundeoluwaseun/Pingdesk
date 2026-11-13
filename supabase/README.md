# Database

PingDesk's tables live in the **Animora** Supabase project (`jtkyvkxyhyhfvoaailxk`, eu-west-2), next to Animora's own tables. They were created by these migrations, already applied there:

- `pingdesk_20261101000100_foundation`: tables, RLS, grants, sign-up trigger
- `pingdesk_20261101000300_gmail_sync`: `claim_inboxes_for_sync`, `finish_inbox_sync`
- `pingdesk_20261101000400_whatsapp_delivery`: delivery and verification functions

**There is no SQL to run.** The schema is already in place.

## Tables (all in `public`)

| Table | What it holds | Browser access |
|---|---|---|
| `profiles` | time zone per user (created on sign-up) | read own |
| `connected_inboxes` | Gmail address, label, sync state | read own |
| `inbox_credentials` | encrypted Google refresh token | none (server only) |
| `notification_preferences` | pause switch and per-category toggles (created on sign-up) | read own |
| `whatsapp_connections` | number, verification and opt-in state | read own (no code hash) |
| `whatsapp_verification_sends` | rate limits for verification codes | none |
| `notifications` | one row per Fiverr email | read own |
| `delivery_logs` | one row per WhatsApp send attempt | read own |
| `jobs` | spare job queue (unused for now) | none |

All writes go through the server with the service-role key.

## Functions the app calls

- `claim_inboxes_for_sync(limit, lease_seconds, min_interval_seconds)`: leases due inboxes with their encrypted token
- `finish_inbox_sync(inbox_id, history_id, reconciled, error_code, needs_reauth)`
- `claim_notifications_for_delivery(limit, lease_seconds)`: leases due alerts with prefs, time zone and WhatsApp status
- `record_delivery_attempt(notification_id, outcome, ...)`: outcome is `submitted`, `retry`, `failed`, `skipped` or `deferred`
- `apply_delivery_status(provider_message_id, status, at, ...)`: only moves a delivery forward
- `start_whatsapp_verification(user_id, phone, code_hash, opt_in_version, ttl_seconds)`: returns `ok`, `invalid_phone`, `already_verified`, `cooldown`, `user_limit` or `phone_limit`
- `confirm_whatsapp_verification(user_id, code_hash)`: returns `verified`, `invalid`, `expired`, `locked` or `none`
- `whatsapp_inbound(phone, action)`: handles STOP / START replies

Animora itself doesn't use Supabase Auth (it has its own `public.users` table), so PingDesk sign-ups in `auth.users` don't affect it.
