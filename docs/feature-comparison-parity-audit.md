# Feature Comparison Parity Audit

Last updated: 15 April 2026

This maps each feature-comparison row on the public pricing section to runtime enforcement and current parity status.

## Matrix

| Feature row | Expected | Enforcement path | Status | Notes |
|---|---|---|---|---|
| Price | Free £0, Pro £39/mo, Team £149/mo | `app/api/billing/checkout/route.ts` (price id mapping) | Pass | Checkout is keyed to explicit price env vars by tier/interval. |
| Seats | Free 1, Pro 1, Team 5 | `lib/billing/entitlements.ts`, `app/api/team/invite/route.ts`, `app/api/team/accept/route.ts` | Pass | Server-side seat cap checks applied at invite and accept. |
| Signal feed | Free delayed 2h, paid real-time | `lib/billing/entitlements.ts`, `app/dashboard/intelligence/signal-feed/page.tsx`, `app/dashboard/overview/page.tsx` | Pass | Client queries now apply `signalDelayMinutes` cutoff from billing status. |
| Physical premium score | Available all tiers | `app/dashboard/overview/page.tsx` | Pass | No paid gate applied; visible for all signed-in users. |
| REMIT alerts | Free delayed 2h, paid real-time | `app/dashboard/intelligence/signal-feed/page.tsx`, `app/dashboard/overview/page.tsx` | Pass | REMIT query now uses same delay cutoff as signal feed. |
| Morning brief | Free delayed to 08:00, paid live 06:00 | `lib/billing/entitlements.ts`, `app/dashboard/brief/page.tsx` | Pass | Brief query applies delay window via entitlement-driven cutoff. |
| Markets covered | Free GB/NBP, Pro five markets, Team all markets | `lib/billing/entitlements.ts`, `app/api/markets/coverage/route.ts`, `app/dashboard/intelligence/markets/page.tsx`, `app/dashboard/overview/page.tsx` | Pass | Dashboard queries and panels now respect entitlement market scope for free-tier coverage. |
| Portfolio positions | Free none, Pro 30, Team unlimited | `lib/auth/require-entitlement.ts`, `app/api/portfolio/positions/route.ts` | Pass | Free blocked; max positions enforced server-side for capped tiers. |
| Signal history | Free 7d, Pro 6m, Team 24m | `app/api/signals/history/route.ts` | Pass | Tier window is enforced on requested history range. |
| API access | Team only | `app/api/v1/premium/route.ts`, `lib/auth/require-entitlement.ts` | Pass | Team+ entitlement required for `/api/v1` scaffold route. |
| Data export | Team only | `app/api/portfolio/export/route.ts`, `lib/auth/require-entitlement.ts` | Pass | Team+ entitlement required before CSV export. |
| Team management | Team plan feature | `app/api/team/*`, `supabase` team tables | Pass | Team create/invite/list/accept flows implemented and gated. |
| Support | Free community, Pro email, Team priority email | Product/process policy | Partial | Operational workflow/SLA labels are not code-enforced. |

## Immediate follow-ups

1. Define and publish support SLA process (email vs priority) so support row is operationally true.
2. Add integration tests for delayed feed/brief and market-scope behavior by tier to protect against regressions.
