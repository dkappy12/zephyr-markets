# Account Deletion Incident Runbook

Use this when `DELETE /api/account/delete` fails in production.

References:

- [app/api/account/delete/route.ts](../app/api/account/delete/route.ts)
- [docs/auth-schema-contract.md](auth-schema-contract.md)
- [ACCOUNT_DELETION_VERIFICATION.md](../ACCOUNT_DELETION_VERIFICATION.md)

## Symptoms

- UI error in Settings Danger Zone after delete attempt.
- API returns `DATA_CLEANUP_FAILED`, `AUTH_DELETE_FAILED`, `PASSWORD_INVALID`, or `UNAUTHORIZED`.
- Spike in account-deletion failure events in `admin_job_log`.

## First 10 Minutes

1. Capture exact API response payload (`code`, `error`, `details`).
2. Confirm if failure is broad or user-specific:
   - one user only
   - multiple users in short window
3. Query recent account-deletion events:

```sql
select created_at, status, message, metadata
from admin_job_log
where job_name in ('auth_audit', 'account_delete')
  and (
    message ilike '%account_delete%'
    or metadata::text ilike '%account_delete%'
  )
order by created_at desc
limit 200;
```

## First 15 Minutes Checklist

1. Acknowledge incident and assign incident lead.
2. Classify impact:
   - single user
   - multi-user
   - systemic auth outage
3. Decide containment:
   - continue normal traffic
   - temporarily disable delete action in UI
4. Post internal status update with next checkpoint time.

## Failure-Type Playbook

### A) `PASSWORD_INVALID`

- Validate user enters current password.
- Check if login is generally healthy (`/login` success for known good user).
- If widespread with known-good credentials, treat as auth provider issue and escalate.

### B) `UNAUTHORIZED`

- Confirm session validity and cookie presence.
- Confirm proxy auth gating still works for protected routes.
- Re-authenticate user and retest once.

### C) `DATA_CLEANUP_FAILED`

1. Identify failing table from payload (`table: ...`).
2. Confirm table ownership contract:
   - Is table listed in [docs/auth-schema-contract.md](auth-schema-contract.md)?
   - Does owner key still exist and match expected column?
3. Validate rows for affected user (replace `USER_ID`):

```sql
select count(*) from alerts where user_id = 'USER_ID';
select count(*) from email_trade_imports where user_id = 'USER_ID';
select count(*) from attribution_predictions where user_id = 'USER_ID';
select count(*) from portfolio_pnl where user_id = 'USER_ID';
select count(*) from positions where user_id = 'USER_ID';
select count(*) from team_members where user_id = 'USER_ID';
select count(*) from team_invitations where invited_by = 'USER_ID';
select count(*) from teams where owner_id = 'USER_ID';
select count(*) from profiles where id = 'USER_ID';
```

4. If teams are owned by user, validate team-linked rows:

```sql
select id from teams where owner_id = 'USER_ID';
select count(*) from team_invitations where team_id in (
  select id from teams where owner_id = 'USER_ID'
);
select count(*) from team_members where team_id in (
  select id from teams where owner_id = 'USER_ID'
);
```

5. Patch route cleanup order/keys if schema drift is confirmed.

### D) `AUTH_DELETE_FAILED`

- Indicates data cleanup likely succeeded but auth admin delete failed.
- Check Supabase service role key validity and auth admin API health.
- Retry deletion only after confirming auth admin operations are healthy.

## Verification SQL After Fix

For a just-deleted user (`USER_ID`), all should be zero:

```sql
select count(*) as alerts_rows from alerts where user_id = 'USER_ID';
select count(*) as email_import_rows from email_trade_imports where user_id = 'USER_ID';
select count(*) as attribution_rows from attribution_predictions where user_id = 'USER_ID';
select count(*) as pnl_rows from portfolio_pnl where user_id = 'USER_ID';
select count(*) as positions_rows from positions where user_id = 'USER_ID';
select count(*) as team_members_rows from team_members where user_id = 'USER_ID';
select count(*) as team_invited_by_rows from team_invitations where invited_by = 'USER_ID';
select count(*) as teams_owned_rows from teams where owner_id = 'USER_ID';
select count(*) as profile_rows from profiles where id = 'USER_ID';
```

Global/shared tables should remain unaffected by user deletion:

- `brief_entries`
- `premium_predictions`
- `scenario_predictions`
- `signal_predictions`
- `accuracy_metrics`

## Rollback / Mitigation

- If deletion endpoint is unstable, temporarily disable delete button in UI and show maintenance message.
- Keep sign-out and profile management functional.
- Communicate to support channel with ETA and incident owner.

## Escalation

Escalate immediately when:

- `DATA_CLEANUP_FAILED` occurs for more than 2 distinct users in 30 minutes.
- `AUTH_DELETE_FAILED` persists for more than 15 minutes.
- Any incident risks orphaning team-linked records at scale.

Escalation path:

1. Auth on-call engineer
2. Platform lead
3. Product owner (if user-facing maintenance banner is required)

### Escalation Contacts

- Auth on-call engineer: `________________`
- Platform lead: `________________`
- Product owner: `________________`
- Security owner: `________________`

### Incident SLAs

- Acknowledge deletion incident: within 15 minutes.
- Deliver first root-cause hypothesis: within 30 minutes.
- Apply mitigation or safe disablement: within 60 minutes.

## Post-Incident Notes Template

- Incident start/end time:
- Primary symptom:
- Root cause:
- Affected users count:
- Immediate mitigation:
- Permanent fix PR/commit:
- Contract doc updated (`docs/auth-schema-contract.md`): yes/no
- Follow-up actions:
