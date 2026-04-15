# Billing Production Readiness Checklist

Use this before enabling paid billing for broader traffic.

## Environment and Secrets

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

## Entitlement and UX

- [ ] Free user gets `403 PLAN_REQUIRED` on premium endpoints.
- [ ] Pro user gets success responses on premium endpoints.
- [ ] Settings page displays `statusLabel`, `accessState`, and action-required banner.
- [ ] Portal CTA opens successfully for delinquent states.

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
