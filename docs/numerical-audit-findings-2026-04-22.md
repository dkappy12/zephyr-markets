# Numerical audit — findings (2026-04-22)

Generated against [`numerical-audit-runbook.md`](./numerical-audit-runbook.md). **Not** independent backtest or regulatory validation.

## Automation run

| Check | Result |
|-------|--------|
| `npm test` (vitest) | **89 tests passed** (27 files) |
| `npm run trust:report` | **quality:reconcile** → pass (3 checks). `quality:gate`, `quality:drift`, `quality:walk-forward` **skipped** (no `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` in this environment). |

Re-run `trust:report` in CI or locally with service role to include gate and drift.

## Phase 1 — Codebase (OK / document / note)

### OK — verified in code

| Item | Notes |
|------|--------|
| **NBP merge** | `buildNbpPthByDayFromGasRows` in `lib/portfolio/gas-aggregate.ts`: `{...fromTtfHub, ...fromDeprecated, ...stooq}` so **Stooq overrides** same day; TTF and deprecated fill gaps. Floors: `NBP_LEVEL_FLOOR_PTH` (30), TTF `TTF_LEVEL_FLOOR_EUR_MWH` (10). |
| **Optimise quality band** | `optimiserQuality` in `app/api/optimise/recommendations/route.ts` has **no** `stabilityPass`; thresholds **0 / 1–2 / 3+** warnings → high / medium / low. |
| **CVaR ≥ VaR (loss convention)** | `lib/portfolio/optimise.ts` `computeRiskMetrics`: `cvarLoss` = mean of losses **≥** `varLoss` on the sorted loss sample → **cvarLoss ≥ varLoss** when tail non-empty. |
| **Optimise objective** | `objectiveLoss` uses `cvar` or `var` consistently; sort uses `objectiveValue = objectiveLoss(after) + tradeCostPenalty(...)`. |
| **Physical signal cards** | `physicalRemitSignalCardImpact` in `lib/portfolio/attribution.ts` uses same **`remitPriceImpactGbpPerMwh` × net MW × calibration** as position-level REMIT; **£1** display rounding; hints for mixed GB, flat residual band, negligible size. Section blurb when `residualDemandGw ≤ 20` in `AttributionPageClient.tsx`. |
| **Attribution — REMIT aggregate** | `sumRemitAttribution` delegates to `remitAttributionForPosition` using the same `remitPriceImpactGbpPerMwh`. |

### Document (product / methodology)

| Item | Notes |
|------|--------|
| **Risk lookback vs Optimise window** | **Optimise** API uses a **fixed 120-day** `sinceDate` for gas/power/fx. **Risk** page supports **30d / 90d / 120d / book** for parts of the UI (histogram, some tiles) while keeping scenario alignment documented in code comments. Traders should not expect **identical** scenario counts to Optimise when Risk is on **30d** or **90d**; align by using **120d** on Risk for comparison. |
| **REMIT: per-signal card vs driver row** | Per-outage cards use **that signal’s** offline MW; aggregate REMIT driver uses **`remit_mw_lost` from the latest physical snapshot** — not the sum of all cards. **Same £/MWh function**, different **ΔMW** input. Explain in support copy if users compare line-by-line. |
| **Piecewise REMIT** | `residualDemandGw ≤ 20` → **0 £/MWh** slope in `remitPriceImpactGbpPerMwh` is **intentional** (see `attribution.ts` comments, Python model alignment). |

### Phase 2 — Browser / “human” pass

**Not executed in this run** (no logged-in session / credentials in the agent environment). **Owner action:** walk Book → Risk (120d) → Optimise → Attribution on a **pro** test account, using fixtures from Phase 0 of the runbook; capture trust-critical screens if anything looks off by order of magnitude.

## Phase 3 — Outcome summary

- **Code paths reviewed:** gas merge, optimiser quality, VaR/CVaR construction, physical REMIT display, test + trust:report.  
- **Blockers for “math sound” label:** **none** from static review + tests; **incomplete** without live Supabase gate and without Phase 2 visual pass.  
- **Follow-ups:** (1) run `quality:ci` or `quality:gate` with secrets before release, (2) complete human pass per runbook, (3) keep investor/regulatory proof **deferred** unless scope expands.

## Sign-off

| Role | This document |
|------|----------------|
| Automated audit (Agent) | Findings as of 2026-04-22; supersede with a new dated file on re-audit. |
