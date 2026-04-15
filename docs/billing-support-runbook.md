# Billing Support Runbook

Use this when billing checkout, portal access, webhook sync, or entitlement status fails in production.

References:

- [app/api/billing/checkout/route.ts](../app/api/billing/checkout/route.ts)
- [app/api/billing/portal/route.ts](../app/api/billing/portal/route.ts)
- [app/api/billing/status/route.ts](../app/api/billing/status/route.ts)
- [app/api/stripe/webhook/route.ts](../app/api/stripe/webhook/route.ts)
- [lib/billing/subscription-state.ts](../lib/billing/subscription-state.ts)
- [lib/auth/require-entitlement.ts](../lib/auth/require-entitlement.ts)

## Symptoms

- User says they paid but premium APIs return `PLAN_REQUIRED`.
- Settings shows `free` while Stripe shows active subscription.
- Checkout completes in Stripe but no `subscriptions` update.
- Webhook events retry repeatedly in Stripe dashboard.

## First 15 Minutes

1. Capture impacted `user_id`, Stripe `customer` id, and Stripe `subscription` id.
2. Confirm webhook delivery status in Stripe (look for last event `200` vs `4xx/5xx`).
3. Check app view of billing:
   - run `GET /api/billing/status` as affected user session.
4. Run SQL checks below to confirm `subscriptions` and `subscription_events` state.

## SQL Triage Queries

Latest subscription state:

```sql
select
  user_id,
  tier,
  interval,
  status,
  stripe_customer_id,
  stripe_subscription_id,
  current_period_end,
  cancel_at_period_end,
  updated_at
from public.subscriptions
where user_id = 'USER_ID'
order by updated_at desc
limit 5;
```

Latest webhook ledger entries:

```sql
select
  stripe_event_id,
  event_type,
  user_id,
  stripe_customer_id,
  stripe_subscription_id,
  status,
  tier,
  interval,
  processed_at,
  created_at
from public.subscription_events
order by created_at desc
limit 50;
```

Duplicate event check:

```sql
select stripe_event_id, count(*)
from public.subscription_events
group by stripe_event_id
having count(*) > 1;
```

## Failure-Type Playbook

### A) Paid in Stripe but app still blocked

- Check `/api/billing/status` output for:
  - `effectiveTier`
  - `status`
  - `accessState`
  - `canUsePremiumNow`
- If Stripe says active but app says free:
  - verify `subscriptions` row exists for same `user_id`.
  - verify RLS select policy still exists for own row.

### B) Webhook delivery failures

- `400` likely signature issue:
  - verify `STRIPE_WEBHOOK_SECRET` matches current Stripe endpoint secret.
- `500` likely processing issue:
  - inspect Vercel logs for `billing_webhook` event metadata.
  - correlate by `eventId`.

### C) Delinquent payment status confusion

- Current policy:
  - `active`, `trialing` -> paid.
  - `past_due` before period end -> grace paid.
  - `unpaid`, `incomplete`, `incomplete_expired` -> premium blocked.
- Ask user to open portal and update payment method for blocked delinquent states.

## Escalation

Escalate immediately when:

- More than 2 users report paid-but-blocked in 30 minutes.
- Stripe webhooks fail for more than 15 minutes.
- `subscription_events` insert failures occur for valid webhook traffic.

Escalation path:

1. Platform on-call engineer
2. Billing owner
3. Product owner (if UI maintenance banner needed)

## Post-Incident Notes

- Incident start/end:
- Primary symptom:
- Root cause:
- Affected users:
- Mitigation applied:
- Permanent fix PR/commit:
- Runbook updates:
