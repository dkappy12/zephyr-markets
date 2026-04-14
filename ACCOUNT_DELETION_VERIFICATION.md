# Account Deletion Verification Checklist

## Preconditions
- User account exists with rows in `portfolio_pnl`, `positions`, `brief_entries`, and `premium_predictions`.
- Route env vars are set: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

## Scenarios
1. Unauthorized request
   - Send `DELETE /api/account/delete` without valid session.
   - Expect `401` with code `UNAUTHORIZED`.

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
   - Call delete as authenticated user with valid env.
   - Expect success payload `{ "success": true }`.
   - Confirm user is signed out and redirected to `/login`.

## Audit Verification
- Confirm `admin_job_log` has lifecycle entries for account delete:
  - `started`
  - `succeeded` or `failed`
- Confirm failure events capture stage context (`cleanup` or `auth_delete`).
