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

## CI and local commands

On every push/PR, GitHub Actions runs **lint → tests → benchmark reconcile → economic quality gate** (see `.github/workflows/ci.yml`).

| Command | Needs Supabase secrets? | Purpose |
|--------|-------------------------|---------|
| `npm run quality:reconcile` | No | NBP/TTF conversion parity vs fixed benchmarks (fails CI on math regression). |
| `npm run quality:gate` | Yes (`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`) | Live 14d MAE, classifier fallback rate, attribution R² vs thresholds. |
| `npm run quality:ci-core` | No | Alias for `quality:reconcile`. |
| `npm run quality:ci` | Optional for gate | Runs reconcile, then gate **if** URL + service role env vars are set (handy before release). |

**GitHub Actions:** Add repository secrets `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` so `quality:gate` actually queries production metrics in CI. Reconcile does **not** use secrets.

**Strict mode:** In `.github/workflows/ci.yml`, `QUALITY_GATE_STRICT=1` makes missing Supabase env or query errors **fail** the gate step; `0` warns and skips when vars are absent (e.g. forks).

- **Reconcile failure** → code/math regression; fix implementation or benchmarks.
- **Gate failure** → live metrics breached thresholds or DB/query issue; investigate data and thresholds.

## Daily Checks (optional)

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

- PRs must pass lint, tests, `npm run quality:reconcile`, and `npm run quality:gate` (when Supabase secrets are configured in CI).
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

