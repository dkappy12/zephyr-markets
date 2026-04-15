# Pre-commercial Foundations Runbook

Last updated: 15 April 2026

## 1) Identity and access

- `proxy.ts` now protects `/dashboard/*` and `/admin/*`.
- Unauthenticated users are redirected to `/login?returnUrl=...`.
- Login now honors `returnUrl` after successful sign-in.
- Verified email is enforced on portfolio write APIs via:
  - `app/api/portfolio/positions/route.ts`
  - `app/api/portfolio/positions/[id]/route.ts`
  - `app/api/portfolio/positions/clear/route.ts`
  - `app/api/portfolio/positions/close/route.ts`
  - `app/api/portfolio/import/route.ts`
  - `app/api/portfolio/attribution/snapshot/route.ts`

## 2) Data safety and boundaries

### API user-scoping matrix (audit snapshot)

- `positions` writes are constrained by `user.id` in payload normalization (`normalisePositionInput(user.id, ...)`) and `eq("user_id", user.id)` on update/delete paths.
- `portfolio_pnl` snapshot write sets `user_id: user.id` server-side.
- `optimise/recommendations` reads positions with `.eq("user_id", user.id)`.
- Account deletion uses service-role cleanup keyed by `user_id`/owner relationships.

### RLS hardening delivered

- `supabase/migrations/20260415143000_auth_audit_log_policies.sql`
  - keeps RLS enabled on `auth_audit_log`
  - revokes anon/authenticated table grants
  - grants service-role read/insert where role exists
  - adds deny-all client policy

## 3) Operational basics

- Structured logging helper: `lib/ops/logger.ts`
- Slack webhook alert helper: `lib/ops/alerts.ts`
  - controlled by `SLACK_WEBHOOK_URL`
- Auth audit logging updated to structured logs + warning alert fallback:
  - `lib/auth/audit.ts`
- Health endpoint:
  - `app/api/health/route.ts`
  - validates required env and lightweight Supabase connectivity

## 4) Backups & restore runbook

- Enable Supabase PITR/backups for production project.
- Minimum cadence:
  - verify backup status daily
  - test restore drill monthly to a staging project
- Targets:
  - RPO: <= 24h
  - RTO: <= 4h for read-only recovery, <= 8h for full write recovery
- Restore owner:
  - one primary + one backup engineer with dashboard access
- Recovery checklist:
  1. Freeze writes (maintenance mode)
  2. Restore to recovery timestamp
  3. Verify critical tables: `profiles`, `positions`, `portfolio_pnl`, `signals`
  4. Verify auth (`auth.users`) and session integrity
  5. Re-enable writes and monitor errors for 60 minutes

## 5) Tiers/subscriptions handoff

- Canonical entitlement policy now lives in:
  - `lib/billing/entitlements.ts`
- Current settings UI references this matrix in:
  - `app/dashboard/settings/page.tsx`
- Tomorrow's Stripe work should map each Stripe product/price directly to `TierCode`.
