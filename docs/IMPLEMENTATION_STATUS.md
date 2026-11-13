# Implementation status

## Present in scaffold
- [x] Next.js dashboard shell
- [x] Supabase client helpers
- [x] Gmail OAuth start and callback route
- [x] Signed OAuth state cookie and nonce comparison
- [x] Refresh-token encryption helper
- [x] Gmail message metadata retrieval
- [x] Conservative email classification adapter
- [x] Notification fingerprinting
- [x] WhatsApp template send helper
- [x] WhatsApp webhook signature validation and delivery status update
- [x] Protected internal Gmail sync route
- [x] Database schema and RLS policies

## Must be completed before real customer use
- [x] Add Supabase Auth UI/middleware and account settings
- [ ] Validate OAuth callback, refresh-token behavior and account-linking edge cases
- [x] Add Google userinfo/profile consent and disconnect/revoke flow
- [ ] Verify sender domains from real authorized Fiverr notification samples
- [x] Email authentication checks (DKIM/DMARC from Authentication-Results)
- [ ] Parser tests against real redacted Fiverr samples
- [x] Add durable notification-delivery worker with preference/opt-in enforcement
- [ ] Add approved Meta template
- [ ] WhatsApp number ownership check (e.g. confirm with a reply or code)
- [ ] Password reset page
- [x] Add webhook idempotency and robust error handling
- [ ] Add rate limiting, audit logging, retention and deletion workflows
- [x] Add Gmail reconciliation with persisted historyId and pagination
- [x] Scheduler (GitHub Actions workflow, any external cron)
- [ ] Deploy and configure monitoring
- [ ] Complete applicable Google OAuth verification and Meta business requirements
- [ ] Security review and end-to-end pilot

## Important
Sync uses Gmail `historyId` with pagination (capped at 200 messages per inbox per run) and falls back to a 24-hour window when history is missing. Delivery claims each alert row before sending, so overlapping runs don't double-send. For many users, move to Gmail push (Pub/Sub `watch`) instead of polling.
