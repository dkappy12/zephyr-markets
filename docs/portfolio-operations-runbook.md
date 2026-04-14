# Portfolio Operations Runbook

Use this runbook for portfolio incidents (import failures, mutation regressions, risk/attribution data quality issues).

## Key Symptoms

- CSV import fails or partially appears to apply.
- Position create/edit/close/delete fails unexpectedly.
- Risk page shows low/no coverage despite expected data.
- Attribution snapshot persistence errors.

## First 15 Minutes

1. Identify affected scope:
   - import only
   - mutation only
   - analytics only
   - broad outage
2. Capture user-visible error and API response payload (`code`, `error`).
3. Confirm auth/session validity for affected user.
4. Confirm recent deploy and changed files under:
   - `app/api/portfolio/*`
   - `components/portfolio/*`
   - `app/dashboard/portfolio/*`

## Import Incident Checks

Endpoint: `POST /api/portfolio/import`

- Verify payload row count <= 200.
- Check rejection reasons (`VALIDATION_FAILED`) for row-level errors.
- Confirm no partial writes were applied when validation fails.

## Mutation Incident Checks

Endpoints:

- `POST /api/portfolio/positions`
- `PATCH /api/portfolio/positions/:id`
- `DELETE /api/portfolio/positions/:id`
- `POST /api/portfolio/positions/close`
- `POST /api/portfolio/positions/clear`

Confirm:

- request is same-origin (CSRF policy),
- authenticated user owns target rows,
- validation failures are explicit (`VALIDATION_FAILED`),
- no client-side direct writes bypassing API routes.

## Analytics Data Quality Checks

- Risk requires aligned price history across relevant series.
- If daily series is sparse, verify source tables have recent rows:
  - `market_prices`
  - `gas_prices`
  - `fx_rates`
- Attribution snapshot endpoint:
  - `POST /api/portfolio/attribution/snapshot`
  - verify `snapshot_hash` presence and upsert success.

## SQL Spot Checks

Replace `USER_ID` with affected user id.

```sql
select count(*) from positions where user_id = 'USER_ID' and is_closed = false;
select count(*) from portfolio_pnl where user_id = 'USER_ID' and date >= current_date - interval '7 day';
```

## Escalation

- Acknowledge incident: within 15 minutes.
- Initial triage: within 30 minutes.
- Containment/mitigation: within 60 minutes.

Owners:

- Portfolio on-call: `________________`
- Platform lead: `________________`
- Product owner: `________________`

## Post-Incident Notes

- Start/end:
- Impacted users:
- Root cause:
- Immediate mitigation:
- Permanent fix:
- Contract update required (`docs/portfolio-schema-contract.md`): yes/no
