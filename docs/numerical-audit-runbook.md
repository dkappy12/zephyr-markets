# Numerical audit runbook

Use this to verify **mathematical consistency in code** and **trader-credible outputs** in the app (order-of-magnitude, units, and messaging—not regulatory sign-off). Re-run after material changes to `lib/portfolio/`, market ingestion, or risk/optimise/attribution surfaces.

## Goals

1. **Integrity:** one clear definition per concept (NBP series, scenario moves, P&amp;L units, attribution drivers). No silent double counting where the product implies a single total.
2. **Consistency across surfaces:** Risk, Optimise, and Book/Attribution should not contradict each other on the same data window when the product promises alignment.
3. **Trust in UI:** numbers and labels match; zeros and dashes are explained (regime, mixed book, rounding), not “broken.”

## Phase 0 — Fixtures

Pick **2–3** stable scenarios and record them in a private note (not this repo) with:

- **A — Minimal:** one GB power leg (or the smallest book that still exercises power).
- **B — Realistic:** a typical customer book (multi-leg, gas + power if you sell that).
- **C (optional) — Edge:** mixed GB power long/short, or very small MW size, to test nets and rounding.

For each, note expected **qualitative** checks only unless you have an external reference (e.g. “VaR and CVaR same ordering as definitions,” not “must equal £x”).

## Phase 1 — Codebase checklist

Work through the table; open the cited modules and confirm behaviour matches comments and invariants.

| Topic | What to verify | Primary locations |
|-------|----------------|-------------------|
| **Gas: NBP levels** | Merged NBP p/th: live TTF + deprecated hub + Stooq; Stooq wins same day. Floors: TTF ≥ €10, NBP ≥ 30 p/th. | `lib/portfolio/gas-aggregate.ts` (`buildNbpPthByDayFromGasRows`, `NBP_LEVEL_FLOOR_PTH`, `TTF_LEVEL_FLOOR_EUR_MWH`) |
| **Optimise data path** | Same gas query hubs as risk merge; 120d window; `nbpProxyUsed` only when merged series missing on a TTF weekday. | `app/api/optimise/recommendations/route.ts` + `lib/portfolio/optimise.ts` |
| **Scenarios** | Historical + stress construction; date union; 0 move vs null for gaps. | `lib/portfolio/optimise.ts` (`buildHistoricalScenarios`, `stressScenarios`) |
| **Optimise objective** | `objectiveLoss` + `tradeCostPenalty`; ranking of packages; stability index on top-3 only. | `lib/portfolio/optimise.ts` |
| **Model quality band** | Data/scenario flags only (not ranking stability). Thresholds: 0 / 1–2 / 3+ warnings. | `app/api/optimise/recommendations/route.ts` (`optimiserQuality`) |
| **Risk** | VaR vs CVaR, stress, scenario counts consistent with `optimise` where shared inputs overlap. | `app/dashboard/portfolio/risk/page.tsx`, `lib/portfolio/optimise.ts` (if shared helpers) |
| **Attribution drivers** | REMIT price impact piecewise in residual-demand bands; wind/gas paths; `physicalRemitSignalCardImpact` uses same `remitPriceImpactGbpPerMwh` + calibration multiplier as aggregate REMIT, with **£1** display rounding on **physical cards** only. | `lib/portfolio/attribution.ts` (`remitPriceImpactGbpPerMwh`, `physicalRemitSignalCardImpact`, `remitAttributionForPosition`); `components/portfolio/AttributionPageClient.tsx` (physical signals + driver table) |
| **Attribution: physical signals** | When £0: residual ≤ 20 GW (0 £/MWh slope), or mixed GB net, or sub-£0.50 after rounding. Section blurb for flat regime. | `components/portfolio/AttributionPageClient.tsx` |
| **Rounding / copy** | `formatGbpColored` vs `—`; explained-% guards when R² is weak (where implemented). | `lib/portfolio/book.ts`; attribution / risk UIs as applicable |
| **Signal feed** | REMIT / asset labelling; `mwDeratedForRow` used for physical cards. | `lib/signal-feed.ts`, `lib/signals` types |

**Sanity invariants to spot-check in code (not theorems):**

- CVaR at the same quantile is **at least** VaR in absolute loss terms for the same distribution (implementation may express losses as positive numbers—align sign convention when comparing).
- Optimise **stability** does not feed **model quality** (option B); both still exposed in `diagnostics` for UI.

## Phase 2 — Browser / MCP pass (“human trader”)

1. **Login** with a test account that has **Book + Pro** (or the tier you sell).
2. For fixture **A** and **B** (same session if possible), walk: **Book → Risk → Optimise → Attribution** (order flexible).
3. For each page, check:
   - **Orders of magnitude** (e.g. multi-million £ on a 5 MW book without story → investigate).
   - **Zeros:** explained by UI copy (regime, mixed net, or methodology), not a bare `£0` with no context on sensitive rows.
   - **Cross-page:** scenario count / window in footer or provenance if shown; NBP/physical stories not contradictory.

Capture screenshots only for **trust-critical** rows: headline risk, model quality + ranking stability, physical signals cards, and any disclaimer banners.

**Playwright / MCP:** use your Cursor Playwright MCP or saved flows to re-run the same path after releases; this runbook does not require automation.

## Phase 3 — Outcomes

Classify each finding as one of:

- **OK** — expected under model.
- **Document** — model choice; add or refresh user-facing or internal doc (link from UI if users ask).
- **Fix** — bug or misleading number/copy; track in issues.
- **Defer** — full backtest, independent numerical validation, or regulatory sign-off (out of scope for this runbook).

## Repeat cadence

- **After** changes to: `lib/portfolio/*`, `app/api/optimise/*`, `app/api/*/risk*`, `gas-aggregate`, attribution calibration, or physical/`signals` ingestion.
- **Before** a material demo or commercial milestone: run Phases 1 + 2 on fixtures **A** and **B**.

## Related

- `docs/numerical-audit-findings-2026-04-22.md` — latest **automated / static** audit results (re-run = new dated file).
- `docs/numerical-audit-human-pass-2026-04-22.md` — **Playwright MCP** public/auth-boundary run (re-run = new dated file).
- `docs/trader-trust-checklist.md` — release QA: staleness, source footnotes, empty states (complements this deeper numerical pass).
- `docs/portfolio-book-operations-runbook.md` — operational feeds and import health.
- `docs/pre-commercial-foundations-runbook.md` — broader go-live checklist.

## Revision

| Date | Notes |
|------|--------|
| 2026-04-22 | Initial runbook (codebase + human pass; no automated numerical proof). |
