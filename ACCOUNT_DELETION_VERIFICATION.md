# Account Deletion Verification Checklist

## Preconditions
- User account exists with rows in user-owned tables: `alerts`, `email_trade_imports`, `attribution_predictions`, `portfolio_pnl`, `positions`, `team_members`, `team_invitations`, `teams`, `profiles`.
- Route env vars are set: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

## Scenarios
1. Password required
   - Open Settings -> Danger zone, confirm delete without entering password.
   - Expect delete action to remain disabled.
   - If API is called without password, expect `400` with code `PASSWORD_REQUIRED`.

1. Unauthorized request
   - Send `DELETE /api/account/delete` without valid session.
   - Expect `401` with code `UNAUTHORIZED`.

1. Invalid password
   - Send valid-session delete request with wrong password.
   - Expect `401` with code `PASSWORD_INVALID`.

2. Missing env configuration
   - Unset one required env var and call `DELETE /api/account/delete` as authenticated user.
   - Expect `500` with code `SERVER_MISCONFIGURED`.

3. Dependent-table cleanup failure
   - Simulate failure on one cleanup table (permissions/table unavailable) and call delete.
   - Expect `500` with code `DATA_CLEANUP_FAILED`.
   - Confirm auth user still exists (auth delete should not run).

4. Auth delete failure
   - Simulate cleanup success + auth admin failure.
   - Expect `500` with code `AUTH_DELETE_FAILED`.

5. Happy path
   - Call delete as authenticated user with valid env and correct password.
   - Expect success payload `{ "success": true }`.
   - Confirm user is signed out and redirected to `/login`.
   - Confirm no orphaned user rows remain in user-owned tables (`alerts`, `email_trade_imports`, `attribution_predictions`, `portfolio_pnl`, `positions`, `team_members`, `team_invitations`, `teams`, `profiles`).
   - Confirm global model/market tables are untouched (`brief_entries`, `premium_predictions`, `scenario_predictions`, `signal_predictions`, `accuracy_metrics`).

## Audit Verification
- Confirm `admin_job_log` has lifecycle entries for account delete:
  - `started`
  - `succeeded` or `failed`
- Confirm failure events capture stage context (`cleanup` or `auth_delete`).
