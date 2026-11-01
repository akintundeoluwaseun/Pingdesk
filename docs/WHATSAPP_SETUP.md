# WhatsApp Cloud API setup

PingDesk sends alerts from **one** WhatsApp Business number that you (the operator) own, using Meta's official Cloud API. Customers never connect their own Meta accounts.

## 1. Meta prerequisites
1. A Meta Business portfolio (business.facebook.com). Business verification is needed to message beyond test numbers and to raise limits.
2. A Meta developer app with the **WhatsApp** product added.
3. A phone number added to the WhatsApp Business Account (it cannot be active in the normal WhatsApp app at the same time).
4. A **System User** with a permanent access token that has `whatsapp_business_messaging` and `whatsapp_business_management`. Temporary tokens from the API setup page expire in about 24 hours and will produce error 190.

## 2. Create the two templates
Create these in WhatsApp Manager → Message templates. The names must match your env vars.

### Alert — category **Utility**, name e.g. `pingdesk_alert`, language `en`
Body (exactly three variables):
```
PingDesk: {{1}} on your {{2}} inbox at {{3}}. Open Fiverr to see the details.
```
Sample values for review: `New buyer message`, `Fiverr seller`, `1 Nov, 10:55 WAT`.
Optional footer: `Reply STOP to pause alerts.`

PingDesk only ever fills these with: the alert type, the customer's own inbox label, and the time. No buyer names, subjects or message text are sent.

### Verification code — category **Authentication**, name e.g. `pingdesk_verify`, language `en`
- Code delivery: **Copy code** button
- Add security recommendation: on
- Code expiration: 10 minutes

Authentication templates have fixed wording set by Meta; you only choose the options above.

> Both templates must use the language code in `META_WA_TEMPLATE_LANGUAGE`.

## 3. Environment variables
```
META_WA_PHONE_NUMBER_ID=      # WhatsApp Manager → Phone numbers → ID (not the phone number itself)
META_WA_ACCESS_TOKEN=         # System User permanent token
META_WA_APP_SECRET=           # App settings → Basic → App secret (signs webhooks)
META_WA_VERIFY_TOKEN=         # any random string, 16+ chars:  openssl rand -hex 16
META_WA_TEMPLATE_ALERT=pingdesk_alert
META_WA_TEMPLATE_VERIFY=pingdesk_verify
META_WA_TEMPLATE_LANGUAGE=en
META_WA_API_VERSION=v26.0
```

## 4. Webhook
App dashboard → WhatsApp → Configuration:
- Callback URL: `https://<your-domain>/api/webhooks/whatsapp`
- Verify token: the value of `META_WA_VERIFY_TOKEN`
- Subscribe to the **messages** field (delivers both message statuses and inbound replies).

Every POST is checked against `X-Hub-Signature-256` using the app secret; unsigned or mis-signed requests are rejected.

## 5. Behaviour
| Situation | What PingDesk does |
|---|---|
| Customer enters number + ticks consent | Sends a 6-digit code via the authentication template (60 s cooldown, 5/hour per account, 5/hour and 10/day per number across all accounts). Codes are stored only as an HMAC, expire in 10 minutes, and lock after 5 wrong tries. |
| New notification | Skipped if alerts are paused, the category is off, the number isn't verified/opted in, or the email is more than 6 hours old. Otherwise the alert template is sent. |
| Per-user safety cap | More than 30 alerts in an hour are deferred 15 minutes, which limits cost if something upstream misbehaves. |
| Temporary Meta error (rate limits, 5xx, 131000/131016/131049/131056 …) | Retried with exponential backoff (1, 2, 4, 8, 16 min …, max 6 h), up to 6 attempts. |
| Permanent error (131026 undeliverable, template/config errors, 190 token) | Marked failed. Configuration errors are logged at `error` level for the operator. |
| Status webhooks | sent → delivered → read, never backwards. A late "failed" can't override "delivered". Pricing category and billable flag are stored. |
| Customer replies STOP / START | Opts out / back in, with a free-form confirmation (allowed because the user just messaged — inside the 24-hour window). |

## 6. Costs
Utility and authentication templates are billed per delivered message by Meta, at rates that depend on the recipient's country. PingDesk records `pricing_category` and `billable` per message from webhooks, and shows customers their monthly alert count. Do not assume messages are free.

## 7. Test mode
Until the number is fully set up, Meta only delivers to numbers on the app's allowed list (error **131030** otherwise). Add your own number under WhatsApp → API setup → "To".
