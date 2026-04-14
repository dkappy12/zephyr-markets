# Auth Production Readiness Checklist

Complete this before declaring auth cutover done.

## Release Policy (Mandatory)

- This checklist is mandatory for any auth-touching release.
- If any required item is unchecked, release is blocked.
- No-go rule: failed auth smoke (`npm run test:e2e` or approved staging equivalent) blocks release.

## Ownership

- SMTP sender owner:
- Vercel env owner:
- Deliverability test owner:
- Incident escalation owner:

## Cutover Checks

- [ ] Supabase SMTP configured to `noreply@zephyr.markets`
- [ ] Reply-to configured to `support@zephyr.markets`
- [ ] Auth templates updated and reviewed
- [ ] Site URL and redirect URLs verified in Supabase
- [ ] Deliverability matrix completed in [docs/auth-email-test-matrix.md](docs/auth-email-test-matrix.md)

## Rate-Limit Checks

- [ ] `UPSTASH_REDIS_REST_URL` set in production
- [ ] `UPSTASH_REDIS_REST_TOKEN` set in production
- [ ] Production redeploy completed after env update
- [ ] Smoke validation confirms `429` + `Retry-After`

## Audit/Operations Checks

- [ ] `auth_audit`/`account_delete` events queryable in `admin_job_log`
- [ ] Alert thresholds defined for unauthorized/rate-limited spikes
- [ ] Incident runbook owner confirmed
- [ ] Account deletion runbook reviewed: [docs/account-deletion-incident-runbook.md](docs/account-deletion-incident-runbook.md)
- [ ] Ownership contract reviewed: [docs/auth-schema-contract.md](docs/auth-schema-contract.md)

## CI / Merge Gates

- [ ] Branch protection requires `Auth PR Checks / auth-fast-checks` before merge
- [ ] Main/nightly `Auth Full E2E / auth-e2e` is monitored and triaged on failure

## Final Sign-off

- [ ] No regressions in login/signup/forgot/reset/verify flows
- [ ] Account deletion flow validated with password confirmation
- [ ] Auth smoke execution recorded (`npm run test:e2e` or staging run)
- [ ] Security owner approval
- [ ] Product owner approval
- [ ] Rollback owner assigned
- [ ] Date recorded

## Sign-Off Record

- Security owner:
- Product owner:
- Rollback owner:
- Sign-off date:
- Release/tag:
