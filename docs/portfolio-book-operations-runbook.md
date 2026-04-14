# Portfolio Book Operations Runbook

This runbook covers import reliability and position mutation health for the Book surface.

## Key Signals

- `portfolio_import_succeeded`
- `portfolio_import_failed`
- `portfolio_import_validation_failed`
- `portfolio_import_rate_limited`
- `classify_positions_model_fallback`
- `portfolio_position_create_failed`
- `portfolio_position_update_failed`
- `portfolio_position_delete_failed`
- `portfolio_position_close_failed`
- `portfolio_positions_clear_failed`

## Reliability Checks

Track these weekly:

- Import success rate (`portfolio_import_succeeded / total import attempts`) >= 98%
- Classifier fallback rate (`classify_positions_model_fallback / classify attempts`) <= 10%
- Median classify latency (p50) <= 12s for 200-row file
- Mutation error rate (`*_failed`) <= 1%

## First 10 Minutes Triage

1. Confirm issue type:
   - Import blocked
   - Wrong classification quality
   - Mark/P&L missing in Book table
   - Mutation failures (create/update/delete/close/clear)
2. Check latest `auth_audit` events in `admin_job_log` filtered by `portfolio_` and `classify_positions_`.
3. Verify dependent feeds:
   - `market_prices` for GB power
   - `gas_prices` for TTF
   - `fx_rates` for EUR/GBP conversion
4. Re-run with small controlled payload (1-3 rows) to isolate row-shape issues.

## Common Failure Modes

### 1) Import returns validation errors

- Symptom: `VALIDATION_FAILED` with row reject details.
- Action: inspect reject list for market/unit/currency mismatches and malformed dates.
- Fix: correct CSV row fields or review classifier normalization.

### 2) Import blocked by model parse errors

- Symptom: no hard fail expected; fallback mode should activate.
- Action: check `classify_positions_model_fallback` volume.
- Fix: if fallback rate spikes, review Anthropic availability or response truncation.

### 3) Current/P&L shows dashes

- Symptom: Current or P&L cells show `—`.
- Action: hover cell for reason; verify mark feed availability and row completeness.
- Fix: restore market data feed, or correct row mapping/unit/currency.

### 4) Mutation returns not found

- Symptom: `POSITION_NOT_FOUND` or `POSITION_NOT_OPEN`.
- Action: confirm position belongs to current user and state is valid.
- Fix: refresh Book state and retry desired action on current row set.

## SQL Snippets

Recent Book events:

```sql
select created_at, status, message, metadata
from admin_job_log
where job_name = 'auth_audit'
  and (
    message like 'portfolio_%'
    or message like 'classify_positions_%'
  )
order by created_at desc
limit 200;
```

Recent import failures:

```sql
select created_at, metadata
from admin_job_log
where job_name = 'auth_audit'
  and message in (
    'portfolio_import_failed',
    'portfolio_import_validation_failed',
    'portfolio_import_rate_limited'
  )
order by created_at desc
limit 100;
```
