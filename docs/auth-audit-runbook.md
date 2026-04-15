# Auth Audit Runbook

This runbook defines auth lifecycle audit events and operator checks.

## Event Stream

Auth events are emitted via:

- structured server logs (`[auth_audit]`)
- optional persisted rows in **`auth_audit_log`** when service role credentials are available (`logAuthAuditEvent`). Account-deletion lifecycle rows may still use `admin_job_log` depending on deployment.

## Key Event Names

- `classify_positions_unauthorized`
- `classify_positions_rate_limited`
- `classify_positions_failed`
- `brief_personalise_unauthorized`
- `brief_personalise_rate_limited`
- `brief_personalise_failed`
- `optimise_recommendations_unauthorized`
- `optimise_recommendations_rate_limited`
- `optimise_recommendations_failed`
- `account_delete_unauthorized`
- `account_delete_password_missing`
- `account_delete_password_invalid`
- `account_delete_completed`

## Operator Queries

Run in Supabase SQL editor.

### 1) Latest API audit events (`auth_audit_log`)

```sql
select created_at, event, status, user_id, metadata
from auth_audit_log
order by created_at desc
limit 200;
```

### 2) Unauthorized spike (last 15 minutes, `auth_audit_log`)

```sql
select
  count(*) as unauthorized_events
from auth_audit_log
where created_at >= now() - interval '15 minutes'
  and (
    event ilike '%unauthorized%'
    or metadata::text ilike '%unauthorized%'
  );
```

### 3) Password-invalid spike for account deletion (last 15 minutes)

```sql
select
  count(*) as invalid_password_events
from admin_job_log
where created_at >= now() - interval '15 minutes'
  and (
    message ilike '%account_delete_password_invalid%'
    or metadata::text ilike '%account_delete_password_invalid%'
  );
```

### 4) Cleanup failures by table (last 24 hours)

```sql
select
  coalesce(
    regexp_replace(message, '^.*table ([a-zA-Z0-9_]+).*$','\1'),
    'unknown'
  ) as table_name,
  count(*) as failures
from admin_job_log
where created_at >= now() - interval '24 hours'
  and message ilike 'Cleanup failed at table %'
group by 1
order by failures desc, table_name asc;
```

### 5) Account deletion outcomes (last 7 days)

```sql
select
  date_trunc('day', created_at) as day,
  status,
  count(*) as events
from admin_job_log
where created_at >= now() - interval '7 days'
  and (
    job_name = 'account_delete'
    or message ilike '%account_delete%'
    or metadata::text ilike '%account_delete%'
  )
group by 1, 2
order by day desc, status asc;
```

## Alerting Suggestions

- `unauthorized_spike`: `>= 20` unauthorized events in 15 minutes.
- `delete_password_invalid_spike`: `>= 10` invalid-password deletion events in 15 minutes.
- `cleanup_failure_any`: any cleanup failure in the last 60 minutes.
- `rate_limit_spike`: repeated `*_rate_limited` for same user/IP over 15 minutes.
- `delete_success_drop`: no successful account deletion events in 24h when attempts are present.

## Cadence and Ownership

- Daily (weekday): review Query 1 + Query 4.
- Weekly: review Query 5 trend and thresholds.
- On alert: run Query 2/3/4 immediately, classify as abuse vs regression.
- Owner: auth on-call (primary), platform lead (secondary).

### Owner Assignments

- Primary on-call owner: `________________`
- Secondary owner: `________________`
- Security approver: `________________`
- Product comms owner: `________________`

### SLA Windows

- Alert acknowledgement: within 15 minutes.
- Initial triage classification (abuse vs regression): within 30 minutes.
- Containment for high-severity auth incidents: within 60 minutes.
- Written incident summary: within 1 business day.

## Response Matrix

1. `unauthorized_spike`
   - Check source concentration (single IP/user-agent vs distributed).
   - If abusive, tighten rate limits and block offending source.
2. `delete_password_invalid_spike`
   - Confirm no login outage/credential stuffing.
   - If concentrated on one account, notify user and monitor.
3. `cleanup_failure_any`
   - Inspect failing table and schema assumptions.
   - Validate with [docs/auth-schema-contract.md](docs/auth-schema-contract.md).
   - Apply hotfix before further deletion attempts.
4. `rate_limit_spike`
   - Confirm limiter backend health (Upstash + fallback status).
   - Adjust per-endpoint ceilings only after abuse classification.

## Incident Checklist

1. Identify event spike class (unauthorized, rate limit, failure).
2. Correlate by user id / endpoint / time window.
3. Confirm if traffic is expected release behavior or abuse.
4. Apply mitigation (temp stricter rate limits, auth maintenance banner, incident response).
5. Record outcome and follow-up action in incident notes.
