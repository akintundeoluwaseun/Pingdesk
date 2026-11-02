# PingDesk launch guide

Follow the parts in order. Each part ends with a **✅ Check** so you know it worked before moving on. Allow about half a day in total, plus waiting time for Meta template approval.

| Part | What | Time |
|---|---|---|
| 0 | Merge the code | 2 min |
| 1 | Finish the database (Supabase) | 10 min |
| 2 | Generate your secret keys | 5 min |
| 3 | Put the app online (Render) | 20 min |
| 4 | Turn on login emails (Supabase Auth) | 10 min |
| 5 | Connect Gmail (Google Cloud) | 30 min |
| 6 | Connect WhatsApp (Meta) | 1 h + approval wait |
| 7 | Start the scheduler | 5 min |
| 8 | Full end-to-end test | 20 min |
| 9 | Before real customers | — |

> Windows tip: all commands below work in **PowerShell** on Windows 10/11. `curl.exe` is built in.

---

## Part 0 — Merge the code
1. Open https://github.com/akintundeoluwaseun/Pingdesk/pull/1
2. Click **Merge pull request** → **Confirm merge**.

✅ **Check:** the `main` branch now has a `docs/` folder and `supabase/migrations/` with 6 files.

---

## Part 1 — Finish the database
PingDesk shares the **Animora** Supabase project. Migrations 1, 3 and 4 are already applied. You need to run **2, 5 and 6**.

1. Go to https://supabase.com/dashboard → open **Animora** → **SQL Editor** → **New query**.
2. On GitHub, open `supabase/migrations/20261101000200_inbox_functions.sql`, click **Raw**, copy everything, paste into the SQL editor, click **Run**.
3. Repeat for `20261101000500_job_queue.sql`, then `20261101000600_product_ops.sql` — **in that order**.

None of these touch Animora's tables. They only create/replace PingDesk's own functions and tables.

✅ **Check:** run this in the SQL editor — it should return **15**:
```sql
select count(*) from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in ('link_gmail_inbox','disconnect_inbox','finish_inbox_sync','start_whatsapp_verification',
    'confirm_whatsapp_verification','whatsapp_inbound','record_delivery_attempt','apply_delivery_status',
    'enqueue_job','claim_jobs','complete_job','release_job','fail_job','enqueue_due_syncs','run_retention');
```

**Copy these for later** (Project Settings → **API Keys** / **Data API**):
- Project URL → `NEXT_PUBLIC_SUPABASE_URL`
- `anon` / publishable key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `service_role` / secret key → `SUPABASE_SERVICE_ROLE_KEY` ⚠️ never share or put in frontend code

---

## Part 2 — Generate your secret keys
Run each line in PowerShell (needs Node.js installed) and save the outputs somewhere safe (a password manager):

```powershell
node -e "console.log('TOKEN_ENCRYPTION_KEY=' + require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log('OAUTH_STATE_SECRET=' + require('crypto').randomBytes(48).toString('base64url'))"
node -e "console.log('INTERNAL_CRON_SECRET=' + require('crypto').randomBytes(48).toString('base64url'))"
node -e "console.log('META_WA_VERIFY_TOKEN=' + require('crypto').randomBytes(24).toString('hex'))"
```

⚠️ **Never change `TOKEN_ENCRYPTION_KEY` later** without a rotation (see README) — saved Gmail connections can't be decrypted with a different key.

✅ **Check:** you have 4 long random values saved.

---

## Part 3 — Put the app online (Render)
Why Render: its free tier allows commercial projects. **Vercel's free (Hobby) plan does not** — it is for non-commercial use only. The scheduler in Part 7 calls the app every minute, which also stops Render's free tier from going to sleep.

1. Sign up at https://render.com with your GitHub account.
2. **New** → **Web Service** → pick the `Pingdesk` repo.
3. Settings:
   - Branch: `main`
   - Runtime: **Node**
   - Build command: `npm ci && npm run build`
   - Start command: `npm start`
   - Instance type: **Free** (switch to **Starter, $7/month** once you have paying customers — no sleep, no surprise restarts)
4. **Environment** → add these (values from Parts 1–2; leave Google/Meta ones for now):
   ```
   NODE_VERSION=22
   NEXT_PUBLIC_APP_URL=https://<your-service>.onrender.com
   NEXT_PUBLIC_SUPABASE_URL=...
   NEXT_PUBLIC_SUPABASE_ANON_KEY=...
   SUPABASE_SERVICE_ROLE_KEY=...
   TOKEN_ENCRYPTION_KEY=...
   OAUTH_STATE_SECRET=...
   INTERNAL_CRON_SECRET=...
   ```
5. Click **Create Web Service** and wait for "Live".

> `NEXT_PUBLIC_…` values are built into the app. If you change them later, use **Manual Deploy → Clear build cache & deploy**.

✅ **Check:** open your `onrender.com` address → the PingDesk landing page loads. Open `/dashboard` → you're sent to the sign-in page.

---

## Part 4 — Turn on login emails (Supabase Auth)
In Supabase → **Authentication**:

1. **URL Configuration**
   - Site URL: `https://<your-service>.onrender.com`
   - Redirect URLs: add `https://<your-service>.onrender.com/auth/confirm` (and `http://localhost:3000/auth/confirm` if you test locally)
2. **Sign In / Providers → Email**: enabled, **Confirm email** on.
3. **Email Templates** (recommended — makes links work across devices):
   - *Confirm signup* — change the link to
     `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/dashboard`
   - *Reset password* — change the link to
     `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password`
4. **Real users need real email sending.** Supabase's built-in email is only for testing and is heavily rate-limited. Before launch, add custom SMTP (Authentication → **SMTP Settings**) — e.g. Resend or Brevo both have free tiers.

✅ **Test authentication**
| Do this | Expect |
|---|---|
| Register with your email | "Check your email" message |
| Click the email link | Lands on the dashboard, "Finish setting up" card shows |
| Sign out, sign in again | Works |
| Wrong password | "That email and password don't match" |
| Forgot password → link → new password | "Password updated", then Activity shows "Changed password" |
| Open `/dashboard` in a private window | Redirected to sign-in |

---

## Part 5 — Connect Gmail (Google Cloud)
1. Go to https://console.cloud.google.com → create a project called **PingDesk**.
2. **APIs & Services → Library** → search **Gmail API** → **Enable**.
3. **Google Auth Platform** (formerly "OAuth consent screen") → **Get started**:
   - App name: PingDesk, support email: yours
   - Audience: **External**
   - Leave the app in **Testing** for now
4. **Audience → Test users** → add every Gmail address you'll test with (max 100 while in Testing).
5. **Data Access → Add or remove scopes** → add `https://www.googleapis.com/auth/gmail.readonly` → Save.
6. **Clients → Create client**:
   - Type: **Web application**
   - Authorized redirect URI: `https://<your-service>.onrender.com/api/google/callback` (add `http://localhost:3000/api/google/callback` for local testing)
   - Copy the **Client ID** and **Client secret**.
7. Add to Render environment, then redeploy:
   ```
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   GOOGLE_REDIRECT_URI=https://<your-service>.onrender.com/api/google/callback
   ```

✅ **Test Gmail**
| Do this | Expect |
|---|---|
| Dashboard → Inboxes → **Connect Gmail** | Google's screen, "Google hasn't verified this app" warning (normal in Testing) → Continue |
| Approve, leaving "Read your email" ticked | Back on Inboxes: "Inbox connected", badge **Connected** |
| Untick the Gmail permission instead | Clear error: "PingDesk needs the Read your email permission…" |
| Rename the inbox (pencil icon) | Name saves; Activity shows it |
| Remove access at https://myaccount.google.com/permissions, then click **Check now** after Part 7 | Within ~1 min the inbox shows **Reconnect needed**; **Reconnect** fixes it |

---

## Part 6 — Connect WhatsApp (Meta)
Full detail: `docs/WHATSAPP_SETUP.md`. Short version:

1. https://developers.facebook.com → **My Apps → Create app** → use case **Connect with customers through WhatsApp** → link/create your Meta Business portfolio.
2. **WhatsApp → API Setup**: Meta gives you a free **test phone number**. Under **To**, add **your own WhatsApp number** and confirm the code Meta sends you. (In test mode, messages only go to numbers on this list.)
3. Copy the **Phone number ID** (not the phone number).
4. **Permanent token**: business.facebook.com → **Settings → Users → System users** → Add (Admin) → **Assign assets**: your app + WhatsApp account (full control) → **Generate token** with `whatsapp_business_messaging` and `whatsapp_business_management`, expiry **Never**. (The token on the API Setup page expires in ~24 hours — don't use it.)
5. **App secret**: App → **Settings → Basic** → App secret → Show.
6. **Templates** (WhatsApp Manager → Message templates → Create):
   - `pingdesk_alert` — category **Utility**, language **English (en)**, body:
     `PingDesk: {{1}} on your {{2}} inbox at {{3}}. Open Fiverr to see the details.`
     Samples: `New buyer message` · `Fiverr seller` · `1 Nov, 10:55 WAT`
   - `pingdesk_verify` — category **Authentication**, language **English (en)**, **Copy code** button, security recommendation on, expiry 10 minutes.
   - Wait for both to show **Active / Approved**.
7. Add to Render environment, redeploy:
   ```
   META_WA_PHONE_NUMBER_ID=...
   META_WA_ACCESS_TOKEN=...        (system user token)
   META_WA_APP_SECRET=...
   META_WA_VERIFY_TOKEN=...        (from Part 2)
   META_WA_TEMPLATE_ALERT=pingdesk_alert
   META_WA_TEMPLATE_VERIFY=pingdesk_verify
   META_WA_TEMPLATE_LANGUAGE=en
   META_WA_API_VERSION=v26.0
   ```
8. **Webhook**: App → **WhatsApp → Configuration → Webhook → Edit**:
   - Callback URL: `https://<your-service>.onrender.com/api/webhooks/whatsapp`
   - Verify token: your `META_WA_VERIFY_TOKEN`
   - Click **Verify and save**, then **Manage** → subscribe to **messages**.

✅ **Test WhatsApp**
| Do this | Expect |
|---|---|
| Webhook "Verify and save" | Green tick (if it fails: wrong verify token or app not deployed) |
| Dashboard → WhatsApp → enter your number, tick consent, **Send verification code** | WhatsApp message with a 6-digit code + Copy code button |
| Enter a wrong code | "That code isn't right" (5 wrong → locked) |
| Enter the right code | "Number verified", badge **Verified** |
| **Send test alert** | Within ~1 min (after Part 7): "PingDesk: Fiverr update on your PingDesk test inbox at …" |
| Reply **STOP** to the PingDesk chat | Confirmation reply; dashboard shows **Stopped**; Activity logs it |
| Reply **START** | Alerts back on |

---

## Part 7 — Start the scheduler (Supabase pg_cron, free)
This is what makes PingDesk run 24/7 without your laptop.

1. Supabase → **Database → Extensions** → enable **pg_cron** and **pg_net**.
2. SQL Editor → run (replace the two values):
```sql
select vault.create_secret('https://<your-service>.onrender.com', 'pingdesk_url');
select vault.create_secret('<your INTERNAL_CRON_SECRET>', 'pingdesk_cron_secret');

select cron.schedule('pingdesk-tick', '* * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'pingdesk_url') || '/api/cron/tick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'pingdesk_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000);
$$);
```
3. Optional backup: GitHub repo → Settings → Secrets and variables → Actions → add `PINGDESK_URL` and `INTERNAL_CRON_SECRET`. The workflow in `.github/workflows/tick.yml` then also runs every 5 minutes.

✅ **Check** (wait 2–3 minutes):
```sql
select status, return_message, start_time from cron.job_run_details order by start_time desc limit 5;
select status_code, content::text from net._http_response order by created desc limit 3;
```
Expect `succeeded` and HTTP **200** with a JSON summary like `{"enqueued":{"syncs":1},"worker":{...}}`.

Health check from PowerShell:
```powershell
curl.exe -H "Authorization: Bearer <INTERNAL_CRON_SECRET>" https://<your-service>.onrender.com/api/admin/status
```
Expect `"healthy": true`. For alerts when something breaks, add this URL (with the header) to a free uptime monitor such as UptimeRobot or Better Stack — it returns **503** when the queue is stuck.

---

## Part 8 — Full end-to-end test
The safest way to get a **real** Fiverr email on demand: request a Fiverr password reset.

1. Make sure: inbox **Connected**, WhatsApp **Verified**, Preferences → **Account security** on, alerts not paused.
2. On fiverr.com → **Forgot password** → enter the email of your connected Gmail. (You don't have to change your password; just let the email arrive.)
3. Wait 1–2 minutes (or press **Check now** on Inboxes).

✅ **Expect**
| Where | Result |
|---|---|
| WhatsApp | "PingDesk: Security alert on your … inbox at …" — no email content |
| Dashboard → History | "Reset your Fiverr password", **Account security**, **Delivered** |
| Click the alert | Timeline: Submitted → Sent → Delivered (→ Read once you open it) |
| Overview | Totals went up by one |

**Also test**
| Test | Expect |
|---|---|
| Turn **Account security** off in Preferences, repeat | History shows **Skipped — category turned off**, no WhatsApp |
| **Pause all alerts**, repeat | **Skipped — alerts paused** |
| Send yourself an email from any normal address | Nothing appears (ignored) |
| Second account in a private window | Sees none of the first account's inboxes/alerts |
| Disconnect inbox | Google access revoked; inbox shows **Disconnected** |
| Settings → Delete account (test account only!) | Account and all its data gone; Google access revoked |

---

## Part 9 — Before real customers
| Item | Why |
|---|---|
| **Google verification** of the Gmail read-only scope | In Testing mode only your listed test users (max 100) can connect, and their access expires every 7 days. Public launch needs Google's app verification and, for this "restricted" scope, an annual third-party security assessment (CASA) — this has a cost. |
| **Meta business verification** + add a real business phone number | Test numbers only message your allowed list; production needs a verified business and its own number. |
| **Custom SMTP** for login emails | Supabase's built-in email is rate-limited. |
| **Render Starter ($7/mo)** | No sleeping, fewer restarts. |
| **Privacy policy + terms pages** | Required by Google and Meta reviews. |
| **Real samples** of new-order / delivered / payment emails | Until added, those Fiverr emails are recorded as "Unclassified" (off by default) rather than guessed. |
| Shared database | PingDesk lives in the Animora Supabase project: both share free-tier limits and one service key. Move PingDesk to its own project when it grows. |

---

## Troubleshooting
| Symptom | Likely cause |
|---|---|
| "Gmail connections aren't available yet" | Google env vars missing on Render, or not redeployed |
| Google error `redirect_uri_mismatch` | The redirect URI in Google must match `GOOGLE_REDIRECT_URI` exactly |
| "Access blocked: app not verified" | Your Gmail isn't in the Test users list |
| Verification code never arrives | Your number isn't in Meta's **To** list (test mode, error 131030), or templates not approved |
| WhatsApp alerts show **Failed** "configuration problem (our side)" | Wrong template name/language, or expired token (error 190) |
| Nothing ever syncs | Scheduler not running — check Part 7 queries and `/api/admin/status` |
| Login email links say "expired" | Site URL / Redirect URLs not set (Part 4) |
| Render logs | Render → your service → **Logs** (JSON lines; tokens and phone numbers are redacted) |
