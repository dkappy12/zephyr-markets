# Billing Production Readiness Checklist

Use this before enabling paid billing for broader traffic.

## Evidence log (fill before launch)

For each section below, record **owner**, **date**, and **evidence** (redacted screenshot, CI run link, SQL output summary, or log line). Keep secrets out of evidence.

| Section | Owner | Date | Evidence / notes |
|--------|-------|------|------------------|
| Environment and Secrets | | | |
| App URLs | | | |
| Database and Policies | | | |
| Webhook Health | | | |
| Past-due / grace | | | |
| Entitlement and UX | | | |
| Operational Checks | | | |
| Rollback | | | |
| Feature Comparison Parity | | | |

## App URLs (required for redirects)

Checkout and portal session URLs are built from `NEXT_PUBLIC_APP_URL` in:

- `app/api/billing/checkout/route.ts` (success/cancel → `/dashboard/overview?billing=...`)
- `app/api/billing/portal/route.ts` (return → `/dashboard/overview?billing=portal_return`)

**Production:** set `NEXT_PUBLIC_APP_URL=https://zephyr.markets` (no trailing slash; code strips trailing slashes). Wrong or missing values cause Stripe to redirect users to the wrong host (often seen as 404).

## Environment and Secrets

- [ ] `NEXT_PUBLIC_APP_URL` set to production origin (see above).
- [ ] `STRIPE_SECRET_KEY` set for production.
- [ ] `STRIPE_WEBHOOK_SECRET` set for production webhook endpoint.
- [ ] `SUPABASE_SERVICE_ROLE_KEY` set in deployment platform.
- [ ] `STRIPE_PRICE_PRO_MONTHLY`, `STRIPE_PRICE_PRO_ANNUAL`, `STRIPE_PRICE_TEAM_MONTHLY` set and current.

## Database and Policies

- [ ] `subscriptions` table exists in production.
- [ ] `subscription_events` table exists in production.
- [ ] `subscriptions_select_own` policy exists for authenticated users.
- [ ] `subscription_events` has no client read/write access.

## Webhook Health

- [ ] Stripe endpoint points to `/api/stripe/webhook`.
- [ ] Endpoint subscribed to:
  - `checkout.session.completed`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
- [ ] Duplicate event replay returns `duplicate: true` and does not mutate subscription state twice.
- [ ] Failed processing returns HTTP 500 and logs `billing_webhook` / `stripe_event_failed` (Stripe will retry).

## Past-due / grace (manual verification)

Use Stripe test mode (or a controlled test subscription):

1. Put subscription into `past_due` with a **future** `current_period_end` in `public.subscriptions` (via webhook or Dashboard).
2. Call `GET /api/billing/status` and confirm `accessState` is `grace`, `canUsePremiumNow` is `true`, and Settings shows the overdue banner.
3. Advance or set `current_period_end` to the **past**; confirm user moves to `free` / restricted per policy.
4. Cross-check [docs/billing-support-runbook.md](billing-support-runbook.md) SQL if rows look wrong.

Automated coverage: `lib/billing/subscription-state.test.ts` (including `past_due` with missing period end).

## Stripe Customer Portal branding (Dashboard, not repo)

In **Stripe Dashboard → Settings → Billing → Customer portal**:

- Upload logo and set brand colour to match Zephyr.
- Configure allowed products/prices for upgrades/downgrades.
- Save and smoke-test **Manage in billing portal** from Settings → Plan & API.

Hosted portal cannot be fully restyled like the Next.js app; in-app copy explains the Stripe handoff.

## Entitlement and UX

- [ ] Free user gets `403 PLAN_REQUIRED` on premium endpoints.
- [ ] Pro user gets success responses on premium endpoints.
- [ ] Settings page displays `statusLabel`, `accessState`, and action-required banner.
- [ ] Portal CTA opens successfully for delinquent states.
- [ ] After checkout or portal return, user lands on **Overview** with a billing confirmation banner (`?billing=success`, `cancelled`, or `portal_return`).
- [ ] Team plan: **Settings → Team** tab shows create/invite/members; invitees can use **`/dashboard/team/join?token=...`** (no browser console required).

## Operational Checks

- [ ] Logs contain `billing_webhook` events (`received`, `processed`, `duplicate_skipped`, `failed`).
- [ ] `/api/billing/status` returns expected fields:
  - `effectiveTier`
  - `status`
  - `statusLabel`
  - `accessState`
  - `actionRequired`
  - `canUsePremiumNow`
- [ ] Manual SQL checks from [docs/billing-support-runbook.md](billing-support-runbook.md) pass.

## Rollback Preparedness

- [ ] Team has rollback owner for billing deployment.
- [ ] Support can temporarily route users to billing portal for manual recovery.
- [ ] Incident response path is shared with on-call.

## Feature Comparison Parity

- [ ] `Price` parity
  - enforced by Stripe price ids in `app/api/billing/checkout/route.ts`.
- [ ] `Seats` parity
  - enforced by team invite/accept seat checks in:
    - `app/api/team/invite/route.ts`
    - `app/api/team/accept/route.ts`
- [ ] `Portfolio positions` parity
  - free blocked + max position limits enforced in:
    - `app/api/portfolio/positions/route.ts`
    - `lib/auth/require-entitlement.ts`
    - `lib/billing/subscription-state.ts`
- [ ] `API access` parity
  - team-only gate enforced in:
    - `app/api/v1/premium/route.ts`
    - `lib/auth/require-entitlement.ts`
- [ ] `Markets covered` parity
  - entitlement scope surfaced in:
    - `app/api/markets/coverage/route.ts`
- [ ] `Signal history` parity
  - tier history windows enforced in:
    - `app/api/signals/history/route.ts`
- [ ] `Data export` parity
  - team-only export gate enforced in:
    - `app/api/portfolio/export/route.ts`
- [ ] `Team management` parity
  - team create/invite/list/accept implemented in:
    - `app/api/team/create/route.ts`
    - `app/api/team/invite/route.ts`
    - `app/api/team/members/route.ts`
    - `app/api/team/accept/route.ts`
  - UI: **Settings → Team** (`app/dashboard/settings/page.tsx`), invite link flow `app/dashboard/team/join/page.tsx`.
