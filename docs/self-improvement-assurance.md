# Self-Improvement Assurance Framework

This document defines how Zephyr evaluates whether platform outputs are safe for
trading intelligence use.

## Reliability Contract

All major outputs should carry a reliability envelope:

- `model_version`
- `data_version`
- `fallback_used`
- `coverage`
- `confidence`
- `evidence`
- `freshness_ts`

Implementation source: `lib/reliability/contract.ts`.

## Daily Checks

Run:

- `npm run quality:walk-forward`
- `npm run quality:drift`
- `npm run quality:reconcile`
- `npm run quality:gate`

## Baseline Thresholds

- Premium MAE (14d) <= `25` £/MWh
- Classifier fallback rate (14d) <= `15%`
- Attribution median calibration R2 (14d) >= `0.05`
- Drift alarms should be empty on daily checks

Thresholds can be changed with environment variables:

- `PREMIUM_MAE_LIMIT`
- `CLASSIFY_FALLBACK_RATE_LIMIT`
- `ATTRIBUTION_R2_MIN`
- `PREMIUM_ERROR_DRIFT_LIMIT`
- `FALLBACK_DRIFT_LIMIT`

## Release Policy

- PRs must pass lint/tests plus `npm run quality:gate`.
- If the quality gate reports `FAIL`, merge/release is blocked until:
  - root cause is identified,
  - a mitigation is applied, and
  - latest gate run passes.

## Trustworthiness Reporting

For each release train, publish a trust report (30d/90d) with:

- premium MAE trend,
- classifier fallback trend,
- attribution calibration R2 trend,
- drift alarm counts,
- benchmark reconciliation results,
- residual known risks and owner.

