# Contact form deployment and cutover

## Default, safe transition

With no environment variables, `GET /api/contact` explicitly returns `formsubmit` mode. The page enables the existing FormSubmit recipient only after loading this configuration. `_captcha=false` has been removed (FormSubmit CAPTCHA is on by default), and `_honey` is the vendor-recognized hidden honeypot. Matter type is required, including **Not sure**. A clearly visible phone alternative remains available. The distinctive subject is `[Axios Website Inquiry] <matter>`.

The UI and business recipient are unchanged. No mail is sent by tests. With JavaScript or configuration unavailable, visitors receive the phone alternative rather than an unverified automatic fallback. The fallback is an interim improvement, not equivalent to the new protected API: callers can still target the public third-party FormSubmit address directly.

## Enable protected mode only after provisioning and verification

Set these **server-side Vercel environment variables** on the intended Axios project and redeploy. Do not put secrets in HTML, Git, logs, screenshots, or chat. Preview and production configuration are separate.

- `CONTACT_FORM_MODE=protected` (default is `formsubmit`; any other value fails closed).
- `CONTACT_ALLOWED_ORIGINS=https://axiosappraisals.com,https://www.axiosappraisals.com` (exact HTTPS origins, no wildcards/trailing slashes). Add only a specific authorized preview origin for preview testing.
- `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`: create a Cloudflare widget restricted to these hostnames. API checks Siteverify success, hostname, and action `axios_inquiry`. Public site key alone is exposed through the config API. Do not use test keys in production.
- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`: HTTPS REST endpoint and write token for a dedicated Upstash Redis database. Atomic Lua INCR/EXPIRE limits each HMAC-pseudonymized IP to 5 attempts per 15 minutes across serverless instances. Token reservations (SET NX EX 600) also prevent duplicate acceptance during Cloudflare's replay convergence window. Redis failure is not bypassed.
- `CONTACT_RATE_LIMIT_SECRET`: at least 32 random characters, separate from provider keys. Redis stores keyed hashes, not raw IP or form content. Counter TTL is 15 minutes; token reservation TTL is 10 minutes. Rotating it resets active limit identities.
- `RESEND_API_KEY`: restricted sending key for a **verified sending domain**.
- `CONTACT_FROM_EMAIL`: bare sender email on that verified domain (e.g. `inquiries@axiosappraisals.com`), never the visitor's email. Resend test domain is rejected. Recipient is fixed server-side to `j.xir@axiosappraisals.com`; visitor email is optional Reply-To only.
- `CONTACT_SENDER_VERIFIED=true`: operator assertion, set only after confirming the sender domain's DNS verification and ability to deliver to the authorized recipient in Resend. This flag does not perform DNS/domain verification itself. Resend remains authoritative and rejected sends fail closed.

No npm packages required. Vercel Node runtime supplies fetch, crypto and AbortSignal; use supported Node 20+ runtime. No changes to existing redirects are required. The rate limit trusts only Vercel's overwritten `x-vercel-forwarded-for`; self-hosted/reverse-proxied operation is unsupported without a reviewed trusted-proxy adapter. Do not replace it with client-supplied `x-forwarded-for`.

## Validation and acceptance

Run `node --test test/*.test.js` and `node --check api/contact.js && node --check assets/contact-form.js` from repository root. Unit tests use mocked providers, no credentials or email transmissions. Tests cover valid flow, validation/byte limits, method/origin/content type, hostname/action/expiry/replay, distributed limit failure, provider failure, duplicate clicks, script/config failure, and no downgrade.

Before cutover, check a preview in desktop and mobile browsers: required matter selection, keyboard focus, real challenge success/expiry, validation, phone link, disabled/error behavior and no-JS notice. Perform one explicitly authorized end-to-end test to the actual inbox and check arrival (API acceptance is not inbox-delivery proof), then test rejected/expired challenges without sending mail. Do not include real client data in tests. Existing business site remains on interim FormSubmit mode until this is done.

## Failure and privacy behavior

POST accepts JSON only, max 8 KiB, validates/limits all expected strings, rejects control/header characters and unknown matter values. Same-origin checks supplement, not replace, challenge and rate-limit protection. No submission contents, tokens, emails, IPs, or provider response bodies are logged by application code. Check provider/platform access-log retention separately. Only form data needed for the inquiry is emailed; Redis sees keyed pseudonymous values and Cloudflare sees the verification token/IP. Each provider request times out, fails closed and never falls back to FormSubmit. If email acceptance is uncertain, the visitor is told to call before retrying. A successful API response means the provider accepted the email, not guaranteed inbox arrival.

## Retire the legacy path

After verified protected-mode deployment, deactivate the old FormSubmit endpoint in the vendor account (check existing account/activation instructions; do not assume an undocumented API). Removing HTML alone does **not** disable direct abuse of that endpoint. Confirm the old endpoint no longer accepts mail. Then remove the FormSubmit branch and hidden vendor fields in a reviewed follow-up. Until retirement, do not claim the old spam route is closed. Roll back intentionally by setting `CONTACT_FORM_MODE=formsubmit` and redeploying only if the old vendor endpoint is still active; never downgrade automatically on a failed challenge, rate limit or provider outage.

## Primary documentation checked November 18, 2026

- FormSubmit CAPTCHA defaults and `_honey`: https://formsubmit.co/documentation (not the unrelated formsubmit.app service).
- Turnstile server verification/action/hostname/replay: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
- Upstash REST commands: https://upstash.com/docs/redis/features/restapi
- Resend sender and email API: https://resend.com/docs/api-reference/emails/send-email

## Targeted solicitation filter (November 22, 2026)

The contact page now includes FormSubmit's documented `_blacklist` with two narrow
phrases from the observed unsolicited submissions: `USD waiting in your account`
and `AI research teams are licensing de-identified business data`. It does not
block general links, payment/settlement language, research, or appraisal data.
The browser gives a visible correction/phone message instead of knowingly sending
matching content to a service that may silently discard it. The same shared policy
rejects matching content in the optional protected API before provider calls.
The HTML field and shared policy are kept in sync by a test. CAPTCHA, honeypot,
required matter/phone, optional fields, destination, and provider selection remain
unchanged. No new accounts or environment settings are needed for this patch.

Limits: this is a targeted content filter, not comprehensive spam prevention.
FormSubmit settings are submitted with the form; a direct caller can omit or alter
`_blacklist` or use another still-active endpoint. Browser checks can be bypassed.
Protected API rules apply only if that mode is provisioned and enabled. No live
mail, provider rejection, or inbox delivery has been tested as part of this patch;
all automated sends use mocks. The existing vendor endpoint has not been retired.
Mailbox rules and retirement require separate follow-up, not this code patch.

Evidence chronology: the first screenshot's submission timestamp is November 18,
2026 at 00:16 UTC, before the prior hardening deployment at 21:12 UTC that day.
It shows a populated legacy `website` field and blank matter. The second image
shows a data-licensing solicitation, but does not establish whether it predates the
hardening. Neither screenshot proves the submitting route or that FormSubmit sold
any data. No suspicious links were visited or included in test fixtures.

Primary references reviewed: https://formsubmit.co/documentation (`_blacklist`,
default CAPTCHA, `_honey`) and https://formsubmit.co/help (vendor deactivation).
Run the existing `node --test test/*.test.js` suite, plus `node --check
assets/contact-policy.js`. Regression tests cover the observed phrases, normalized
matching, legacy-field content, legitimate legal inquiries and URLs, visible
browser rejection/retry, unchanged configuration, and absence of provider calls
for rejected requests. This does not certify FormSubmit's own matching behavior.
