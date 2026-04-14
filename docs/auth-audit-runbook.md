# Auth Audit Runbook

This runbook defines auth lifecycle audit events and operator checks.

## Event Stream

Auth events are emitted via:

- structured server logs (`[auth_audit]`)
- optional persisted rows in `admin_job_log` when service role credentials are available

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

In Supabase SQL editor:

```sql
select created_at, status, message, metadata
from admin_job_log
where job_name in ('auth_audit', 'account_delete')
order by created_at desc
limit 200;
```

## Alerting Suggestions

- Spike in `*_unauthorized` events over 5-minute window.
- Repeated `*_rate_limited` events for same user/IP.
- Any increase in `account_delete_password_invalid` without corresponding successful deletes.

## Incident Checklist

1. Identify event spike class (unauthorized, rate limit, failure).
2. Correlate by user id / endpoint / time window.
3. Confirm if traffic is expected release behavior or abuse.
4. Apply mitigation (temp stricter rate limits, auth maintenance banner, incident response).
