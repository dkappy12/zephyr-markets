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
- Admin recovery (no external tooling):
  - use `POST /api/admin/billing/reconcile` with JSON `{ "userId": "..." }`
  - expected outcome:
    - `subscriptions` row is upserted for that `user_id` from Stripe’s latest active/trialing/past_due subscription
    - an audit row is inserted into `subscription_events` with `event_type = manual.reconcile`
  - re-check:
    - `GET /api/billing/status` as the affected user
    - and the SQL queries above for `subscriptions` + `subscription_events`

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

### D) Team member appears on free vs team seat

- Confirm whether user is team owner or team member:
  - team owner rows are in `teams.owner_id`.
  - team members are in `team_members` with `status = active`.
- Current policy:
  - team owners use their own subscription row.
  - active team members inherit owner billing for entitlement checks.
- If member appears free:
  - verify membership row exists and is active.
  - verify owner has active/grace subscription in `subscriptions`.
  - check `GET /api/billing/status` for `teamMemberOfOwnerId`.

### E) Invite not received / duplicate pending invite

- Invite flow is idempotent for pending invites:
  - re-inviting same email should reuse existing pending invite and resend email.
- If invite fails to arrive:
  - check Resend logs for outbound delivery errors.
  - verify `RESEND_API_KEY` is present in runtime environment.
  - verify sender domain and `noreply@zephyr.markets` are valid.
- If seat cap is reached:
  - cancel stale pending invites in Team Settings (Pending invitations) or remove member.
  - retry invite after seat count drops.
- If user reports duplicate/pending confusion:
  - copy and share the existing invite link from Team Settings.
  - cancel/reissue if necessary.

## Webhook Monitoring Guidance

- Quick health snapshot (admin-only):
  - `GET /api/admin/billing/health` returns a compact JSON summary of recent `subscription_events`:
    - totals in the last 1h / 24h (based on `processed_at`)
    - approximate duplicate rate in the sample window (based on repeated `stripe_event_id`)
    - the most recent `manual.reconcile` runs

- Primary alert conditions:
  - Stripe webhook endpoint returns repeated `5xx`.
  - Stripe dashboard shows automatic retries climbing for `invoice.*`/`customer.subscription.*`.
  - App logs show repeated `stripe_event_failed` or processing errors by `eventId`.
- Suggested thresholds (starting point):
  - `>=3` webhook failures in 5 minutes: warn.
  - `>=10` webhook failures in 10 minutes: page on-call.
  - any sustained failure >15 minutes: incident.
- First checks:
  1. Stripe dashboard event delivery status for endpoint health.
  2. Vercel/server logs for `/api/stripe/webhook` and `eventId`.
  3. `subscription_events` inserts and status transitions.
- Recovery posture:
  - fix root cause.
  - resend latest failed event from Stripe dashboard.
  - confirm idempotent handling (`duplicate: true` path for replays).

## Break-Glass Procedure (admin-only)

Use this when Stripe shows paid/trialing/past_due but the app still blocks the user.

1. Confirm symptom:
   - `GET /api/billing/status` as affected user shows `effectiveTier=free` or `canUsePremiumNow=false`.
   - Stripe dashboard shows an active/trialing/past_due subscription for same user.
2. Run reconcile as admin:
   - `POST /api/admin/billing/reconcile`
   - body: `{ "userId": "AFFECTED_USER_ID" }`
3. Expected response:
   - `ok: true`
   - `stripeCustomerId`, `stripeSubscriptionId`
   - `applied` payload with `tier`, `interval`, `status`, and `current_period_end`
4. Validate recovery:
   - `GET /api/billing/status` as affected user now reflects paid/grace state.
   - `GET /api/admin/billing/health` shows latest `manual.reconcile` in `manualReconciles`.
5. Stop/go criteria:
   - stop and escalate if reconcile returns `404`, `409`, or repeated `500`.
   - stop and escalate if user remains blocked after successful reconcile response.

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
