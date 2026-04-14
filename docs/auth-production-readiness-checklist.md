# Auth Production Readiness Checklist

Complete this before declaring auth cutover done.

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

## Final Sign-off

- [ ] No regressions in login/signup/forgot/reset/verify flows
- [ ] Security owner approval
- [ ] Product owner approval
- [ ] Date recorded
