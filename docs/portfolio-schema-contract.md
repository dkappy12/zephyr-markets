# Portfolio Schema Contract

This document defines the expected portfolio data contract used by import, mutation APIs, and analytics pages.

## Core Ownership

- Portfolio tables are user-owned by `user_id`.
- All mutations must enforce authenticated ownership on server routes.

## Positions Contract

Required fields for create/update/import:

- `instrument`: non-empty string
- `instrument_type`: non-empty string
- `market`: non-empty string
- `direction`: `long` or `short`
- `size`: finite non-zero number
- `unit`: one of `mw|mwh|therm|mmbtu|tco2|lot`
- `entry_date`: `YYYY-MM-DD`

Optional fields:

- `tenor`: string | null
- `trade_price`: finite number | null
- `currency`: `GBP|EUR|USD` | null
- `expiry_date`: `YYYY-MM-DD` | null
- `notes`: string | null
- `raw_csv_row`: stringified JSON | null

Server defaults:

- `source`: `manual` unless supplied
- `is_hypothetical`: `false`
- `is_closed`: `false`

## Import Safety Rules

- Maximum 200 rows per import request.
- Import is atomic (single insert operation) after full validation pass.
- Duplicate rows within one batch are rejected using canonical dedupe key:
  - instrument + market + direction + size + unit + tenor + entry_date + trade_price.

## Analytics Contract

Risk/attribution calculations must:

- avoid silent zero-filling for missing required series,
- fail clearly or skip sample points when dependent prices are absent,
- preserve explicit fallback behavior where fallback is intentional (e.g., FX fallback constant).

## PR Checklist (Schema/Logic Drift)

Any PR touching portfolio schema or contract-sensitive logic must update:

1. `docs/portfolio-schema-contract.md`
2. portfolio API validation (`app/api/portfolio/*`)
3. portfolio verification/runbook docs (`docs/portfolio-operations-runbook.md`)
4. tests (`app/api/portfolio/**/*.test.ts` and/or `e2e/portfolio-smoke.spec.ts`)
