# Portfolio audit — 21 Apr 2026

**Scope:** `https://zephyr.markets/dashboard/portfolio/*` (Book, Risk, Optimise, Attribution) on live production, signed in as DK. Desktop 1440 × 900 only. No mobile pass.

**Evidence:** 40+ screenshots under `audit-book-*.png`, `audit-risk-*.png`, `audit-optimise-*.png`, `audit-attribution-*.png` at repo root; raw running log in `audit-notes.md`.

Everything below is ranked by severity × confidence. Each finding has a concrete fix recommendation and a file:line anchor (line numbers in file paths are **stale** relative to the current repo — re-grep if you need exact sites). **Subsequent implementation work** addressed most items in waves 1–4; see **Status & closeout** at the end of this document for a snapshot against the codebase.

---

## Ship-blockers (must fix before any launch push)

### 1. Risk toggle is invisible when selected
`[RISK] HIGH VIS`

`Since book opened`, `30d`, `90d`, `120d` on the Risk page all render as black-on-black when active because the active-state class uses `text-ivory-bg`, which is **not a defined Tailwind token** (only `ivory`, `ivory-dark`, `ivory-border` exist in `tailwind.config.ts`). The class silently collapses to no color and the text inherits the parent `--ink` (dark).

- File: `app/dashboard/portfolio/risk/page.tsx:1367`
- Token check: `tailwind.config.ts:7-9`
- Fix: change `text-ivory-bg` → `text-ivory` (or add `--ivory-bg` to the theme map).
- Evidence: `audit-risk-03-toggle-book-opened.png`, `audit-risk-04-toggle-30d.png`, `audit-risk-05-toggle-90d.png`, `audit-risk-06-toggle-120d.png`.

### 2. Simulated daily P&L is ≈£0 for every day before book-opened
`[RISK] HIGH CORR` — this is the bug you flagged

The chart allocates DOM rects for the full 120-day window (DOM probe confirms alternating green/red fills), but every bar left of the `Book opened 14 Apr` marker is 0–1 px tall; bars on/after 14 Apr are 9–51 px. So the subheading promise (“Bars left of the ‘book opened’ marker show what today’s positions would have returned on days before you held them”) is broken.

Root cause isn’t in `calculateDailyPnL` itself — it already iterates today’s positions against each historical day (`app/dashboard/portfolio/risk/page.tsx:371`). The actual cause is **NBP history is only 7 days old** (`hub = 'NBP'`, Stooq NF.F, 2026-04-10 → 2026-04-20). Pre-10-Apr, `nbpPricesByDay[prevDate]` is `null` on line 447 and NBP contributions — which account for 59 % of the book by notional — are skipped. With the biggest leg missing, the remaining contributions net to ~£0.

- File: `app/dashboard/portfolio/risk/page.tsx:444-456`
- Data: `gas_prices` table — `NBP` source has 7 rows, `NBP_DEPRECATED_YAHOO_BACKFILL` has 342 rows
- Fix options (pick one):
  1. Re-map `NBP_DEPRECATED_YAHOO_BACKFILL` → `NBP` for historical VaR/stress reads (explicit "historical-only" flag).
  2. Actively backfill Stooq NF.F for the last 120 days so `NBP` has full coverage.
  3. Add a banner under the chart when NBP coverage < 20 days explaining why bars are small.
- Evidence: `audit-risk-06-toggle-120d.png` plus DOM probe in `audit-notes.md`.

### 3. Close-position modal defaults to entry price (locks in a false zero P&L)
`[BOOK] HIGH UX/CORR`

Opening "Close" on any position pre-fills `Close price` with `position.trade_price` (entry price). A user who clicks through books the position at the entry price → realises £0 P&L for a position that had real mark-to-market P&L.

- File: `components/portfolio/BookPageClient.tsx:1106-1110`
- Fix: pre-fill with the current mark from the same source the table uses (`powerPricesByDay`, `ttfPricesByDay`, `nbpPricesByDay`, carbon, etc.). Fall back to entry price only when no mark source exists (and in that case, also label the field as "no mark — enter manually").
- Evidence: `audit-book-08-close-modal.png`.

### 4. Quick-add accepts negative size and unbounded trade price
`[BOOK] CRIT CORR`

Quick-add’s validation is `if (!Number.isFinite(sz) || sz === 0)` — i.e. only a strict-zero check. Entering `-50` or `99999` as size/price is accepted server-side and renders a `LONG -50 mw @ £99,999/MWh` row with a phantom `+£4,993,956` Total P&L.

- File: `components/portfolio/QuickAddModal.tsx:162-171`
- Fix: `if (!Number.isFinite(sz) || sz <= 0)` — direction is already carried by the LONG/SHORT toggle. Also clamp `tp` to plausible per-market bands (e.g. GB Power: £0–£500/MWh; NBP: 0–600p/th; UKA: £0–£200/t; etc.). Matching server-side guard in `/api/portfolio/positions` is probably worth pairing.
- Evidence: `audit-book-04-quickadd-negative-size.png`.

### 5. VaR on Risk (£322) and VaR on Optimise (£2,413) disagree by 7.5×
`[OPTIMISE] HIGH CORR`

Same account, same book, same window, same metric label (`95% 1-day VaR` / `VaR 95`) — two materially different numbers. Users making sizing decisions will pick the smaller one.

Root cause: **Optimise requires all three price series (power ∩ TTF ∩ NBP) to have data on the same day**; Risk uses a union and accepts partial days.

- Optimise intersection: `lib/portfolio/optimise.ts:621-623` (`buildHistoricalScenarios`)
- Risk union: `app/dashboard/portfolio/risk/page.tsx:386-393` (`dateUniverse = new Set([...])`)
- Footer confirms this: Optimise says `Scenarios 12 (hist 0 · stress 6) · Window 120d from 2025-12-22`, i.e. **zero** historical scenarios even though Risk finds 86.
- Fix: mirror Risk’s union-of-dates approach in `buildHistoricalScenarios`, skipping the missing-market contribution per-day (same guardrails as `calculateDailyPnL`). This will typically give Optimise ≥ 60 historical scenarios on the current dataset and should collapse the 7.5× gap.
- Evidence: `audit-risk-01-full.png` vs `audit-optimise-01-full.png`.

---

## High-severity correctness issues

### 6. Risk-by-position vs. stress scenarios disagree on GB Power coverage
`[RISK] HIGH CORR`

The `No mark source` banner promises GB Power is supported. But every `GB_power` row in the `Risk by position` table shows `Worst day —` and `Share of gross risk 0%` (15 rows — GB Baseload M+1, Q3-2026, Peakload/Offpeak Jan-2027, Cal-2028 long + short, Q1-2028, Spark/Dark Spread Q1-2027 and Sum-2027, N2EX DA SP20, APX DA SP32, GB Balancing Product). At the same time, the stress-scenario cards happily shock these GB_power legs (2022 Energy Crisis: `GB Baseload M+1 +£10,000`, `APX DA SP32 +£6,400`, etc.).

So the stress engine has GB_power shocks wired up, but the historical-VaR pipeline does not. Either ship the GB_power historical component or drop GB_power from the “supported markets” banner.

- Files involved: `app/dashboard/portfolio/risk/page.tsx:414-427` (GB_power branch in `calculateDailyPnL`) — likely `powerPricesByDay` is being populated from a narrower source than expected. Worth confirming `market_prices` table has enough history for GB power.
- Evidence: `audit-risk-07-position-table.png`, `audit-risk-08-stress-scenarios.png`, `audit-risk-09-stress-expanded.png`.

### 7. Spread positions mark as the underlying, not as the spread
`[BOOK] HIGH CORR`

`Spark Spread Q1-2027`, `Dark Spread Q1-2027`, `Spark Spread Sum-2027`, `Dark Spread Sum-2027` all show `Current = £119.89/MWh` — i.e. the GB baseload outright price. A spark spread is `power − heat_rate × gas − emission_factor × carbon`; the number shown has no spread information in it, which propagates into the wrong Total P&L on the Book page and wrong factor attribution on Attribution (Spark Spread Q1-2027 attribution shows only Wind+REMIT, no Gas/Carbon legs).

- Likely site: wherever `currentMark` is chosen for `instrument_type = SPARK_SPREAD | DARK_SPREAD` — it’s falling through to the power branch. Lives near `lib/portfolio/book.ts` mark-selection.
- Fix: compute a synthetic spread mark `currPower − HR × currGas(£/MWh) − EF × currCarbon(£/MWh)` with reasonable HR/EF defaults.
- Evidence: `audit-phase1-landing.png` Spark/Dark Spread rows.

### 8. UKA/EUA positions are flat in attribution despite non-zero carbon driver
`[ATTRIB] HIGH CORR`

`Carbon (SRMC split) +£262` is reported as a system-level driver. In the per-position detail, `UKA Dec-2026 (Long 700 tco2)` and `EUA Dec-2026 (Short 500 tco2)` both show `Subtotal +£0` — the driver row is routing 100 % of its attribution through the SRMC stack (power × emission factor) and skipping the literal carbon allowances.

- Files to check: attribution model in `lib/portfolio/attribution.ts` (or similar) for UKA/EUA leg accounting.
- Fix: UKA/EUA positions should attribute to the Carbon driver directly via `(currCarbon − prevCarbon) × size × direction` in £ — and have that share netted out of the SRMC stack to avoid double counting.
- Evidence: `audit-attribution-03-position-detail.png`, `audit-attribution-05-position-detail-end.png`.

### 9. Attribution reports “97 % explained” with R² = 0.00
`[ATTRIB] HIGH CORR`

The calibration panel says `n=8, R²=0.00, λ=3 (fallback multipliers)` and the banner says `Calibration sample too small (8/30) — using conservative multipliers` / `Calibration fallback active due to weak fit quality` — then still renders `Explained 97 %` in the header KPI. Zero R² means the model has no explanatory power on the historical sample; the 97 % is an arithmetic identity (multipliers × drivers ≈ realised P&L by construction), not a real fit.

- Fix: when R² < some threshold (e.g. 0.1) OR `n < λ_min`, don’t display a `% explained` number at all; render `—` with a tooltip explaining the sample isn’t big enough to compute explained variance.
- Evidence: `audit-attribution-01-full.png`.

### 10. Confidence toggle on Optimise is a no-op
`[OPTIMISE] MED/HIGH CORR`

Flipping `95% → 99%` doesn’t change `VaR 95` / `CVaR 95` tile labels (they’re hardcoded) *and* doesn’t change the `£2,413` value (VaR_99 should be ≥ VaR_95 strictly). With only a 12-scenario fallback distribution, the 99th percentile index collapses to the 95th by the floor in `calculateVaR` (`const index = Math.floor((1 - confidence) * sorted.length)` — `Math.floor(0.01 * 12) = 0`, same as `Math.floor(0.05 * 12) = 0`).

- File: `app/dashboard/portfolio/risk/page.tsx:491-496` (the VaR calc is shared).
- Fixes: (a) rename tile labels dynamically (`VaR ${Math.round(confidence*100)}`), (b) when `sorted.length * (1 - confidence) < 1`, return null / render `—` with `Need N+ scenarios` like Risk already does for 99% 1-day VaR.
- Evidence: `audit-optimise-03-conf99.png`.

---

## Medium-severity issues

(grouped by area — see `audit-notes.md` for evidence pointers on each)

**Book page**
- UKA/EUA/UKA Spot show `Today P&L = —` but populate `Total P&L` — today’s delta should be computable from current vs. yesterday’s close.
- Edit position modal exposes `Instrument type` dropdown but not instrument name; table rows like "GB Baseload M+1" are read-only from Edit.
- Trade price unit label literally says "£/unit" regardless of instrument (wrong for NBP p/th, TTF EUR/MWh, EUA EUR/t).
- `Escape` key does not close Quick-add / Edit / Close modals (a11y expectation broken).
- `Book updated` timestamp derives from `max(positions.modified_at)` so deletes *revert* it backwards. Track last-mutation in a column instead.

**Risk page**
- `Worst day` tile is sourced from `since book opened` regardless of the histogram window — either change label or honour the window.
- `coverage 72%` headline doesn’t reconcile with 31/37 excluded-legs (84%) or the 13 legs with non-zero worst-day (35%). Ambiguous denominator.
- Tenor concentration bars sum to 101% (rounding).
- Stress scenario library is 5 gains + 1 loss — add at least one symmetric bearish gas shock so users don’t misread the book as positively skewed.

**Optimise page**
- `Worst Stress` tile stays at £2,413 when `Stress scenarios` is toggled off; should read `—` or recompute.
- `Generated` timestamp uses US locale (`4/21/2026, 10:45:55 PM`) — everywhere else is `DD MMM YYYY, HH:mm`.
- `COVERAGE 0 %` tile needs a tooltip defining what’s being covered.
- Controls stay enabled when model quality is LOW even though they have no effect — disable them and explain the gating.

**Attribution page**
- `NBP Winter-2026 (Long 42000 therm)` attribution includes a `Carbon-cost split: +£294`. NBP gas has no direct carbon obligation; either rename ("Gas × Carbon cross-term via implied SRMC") or drop.
- `Spark Spread Q1-2027` attribution shows only Wind + REMIT — missing Gas and Carbon legs, despite being a spread with those factors baked in.
- Nordic/German/French baseload rows show `Subtotal +£0`; prefer `—` to avoid implying a real £0 attribution.
- `EXPAND POSITION DETAIL ▼` arrow doesn’t flip to `▲` after expansion.
- `Book alignment: BEARISH for your book` + `Total P&L today: +£1,679` together look self-contradictory — rewrite copy to explain the causal chain.

---

## Low-severity / polish

**Book**
- `Entry price = £99,999` renders as `£99999.00/MWh` with no thousands separator, unlike all other numeric cells.
- Table row order changes after add/delete; no user-visible sort controls.
- Default instrument name for Quick-add is `GB Power Forward` (the dropdown label), not a tenor-aware synthetic like `GB Baseload Month+1`.
- `LNG JKM Jan-2027` and `Henry Hub Jan-2027` both mark at `£36.59/MWh` — same number, likely falling back to the same proxy.
- `Fuel Oil Crack` classified under `POWER` (and priced £/MWh) rather than a gas/oil category.
- Hover on `No mark source` badge produces no tooltip.

**Risk**
- `Simulated daily P&L` subheading reads "the last 120days of market moves" (missing space).
- Bottom caption has "book opened 14 Apr· VaR tiles" (missing space before `·`).
- `Show all 31 legs` button appears on every stress card regardless of whether each scenario has material per-leg impact.
- `99% 1-day VaR` shows `Need 100+ days (have 86)` — no progress indicator for "available in ~14 days".

**Optimise**
- Stability `Index 0.314` has no scale. Display as `0.314 / 1.00 threshold 0.25` or similar.

**Attribution**
- Y-axis labels format as `£-5,412` (sign after `£`). House style elsewhere is `−£5,412`.
- 14 Apr cumulative P&L opens at ≈ `−£5,412` — indicates entry prices are systematically above/below market close on day 0. Either flag ("Book opened with −£5,412 unrealised") or re-mark entry prices at book-open close.

**Global**
- `Net delta +66 MW net long` headline on both Book and Risk ignores NBP (the 59% slice by notional) because it's denominated in therms. Footer caveat "MW positions only · gas positions in therms excluded" is present but easy to miss.

---

## What I did not test (out of scope / deferred)

- Mobile / responsive breakpoints (you said no)
- CSV import with malformed files (didn’t want to exercise destructive import without a CSV in hand)
- Empty-book state via `Clear book` (skipped to avoid destroying the fixtures)
- Save Limits form submit with negative/boundary values
- `Connect broker email →` flow
- Non-portfolio pages (`/overview`, `/intelligence/*`, `/brief`, `/admin`) — out of scope
- Keyboard-only full traversal (partially tested; Escape-on-modal captured above)

---

## Suggested order of attack

If you want to ship these, here’s the dependency order I’d pick:

1. **Finding 1** (text-ivory-bg) — 1-line CSS fix, pure UX win, no risk. Ship same day.
2. **Finding 4** (Quick-add validation) — small fix in one component + optional server guard. Critical; ship within a day.
3. **Finding 3** (Close modal default) — one useState init change. Protects against a user booking zero P&L by accident.
4. **Finding 5** (Optimise intersection → union) — single function in `lib/portfolio/optimise.ts`. Unblocks the whole Optimise page; has tests already in `optimise.test.ts`, update them.
5. **Finding 2** (pre-book-opened bars) — pick the NBP backfill strategy first (data-migration question), then the chart and Finding 6 both resolve.
6. **Finding 9** (attribution 97 % with R² = 0) — one conditional in the KPI strip.
7. **Findings 7 + 8** (spread marking + UKA/EUA attribution) — need a bit of modelling thought; pair before coding.
8. Everything under Medium / Low as capacity allows.

---

## Status & closeout (repo review, post-waves 1–4)

This section records a **read-only** pass against the `zephyr-markets` repo after portfolio fixes landed. Use it to retire or verify findings; it does not replace a full production smoke test.

**Legend:** **Done** = addressed in code to match intent. **Done (verify)** = implemented; worth one live check. **Open / verify** = depends on data or needs confirmation on prod. **Deferred** = still in “what we did not test” or explicit deferral.

### Ship-blockers (§1–5)

| # | Verdict | Notes |
|---|---------|--------|
| 1 | **Done** | Active risk histogram toggle uses `text-ivory` (not undefined `text-ivory-bg`). |
| 2 | **Done (code) / verify (UX+data)** | NBP day series merged from Stooq + deprecated hub in Risk (`buildNbpPthByDayFromGasRows` + comments). Optional “NBP under 20 days of coverage” banner from the audit is **not** implemented as a dedicated callout. Re-verify chart behaviour on live `gas_prices` depth. |
| 3 | **Done** | Close-position modal pre-fills from `getCurrentMarkNumeric` when a mark exists. |
| 4 | **Done** | Client: `sz <= 0`; server: `normalisePositionInput` + `getTradePriceBounds` validation. |
| 5 | **Done** | `buildHistoricalScenarios` uses **union of dates** with per-market null→skip/0, matching Risk’s approach. |

### High-severity (§6–10)

| # | Verdict | Notes |
|---|---------|--------|
| 6 | **Open / verify** | If production still shows GB rows at 0% historical risk, confirm `market_prices` history and row typing — code path exists for N2EX/APX-aggregated power. |
| 7 | **Done** | Synthetic spread marks via `lib/portfolio/spread-marks.ts` and Book. |
| 8 | **Done (verify)** | UKA/EUA allowance and SRMC work landed in a prior fix; re-verify screenshots if regressions are suspected. |
| 9 | **Done** | Explained % hidden when `fallbackUsed` or R² below 0.1 (`AttributionPageClient` KPI). |
| 10 | **Done (verify)** | Optimise tiles use dynamic `VaR ${pct}%` / `CVaR ${pct}%` and `historicalTailReliable` guards; smoke 95% vs 99% on live. |

### Medium & low (§120–176)

Treated in bulk: **most medium and low items are done** in waves 2–3 (book/risk/optimise/attribution) and **wave 4** (polish: sort, entry formatting, copy, tooltips, stress leg expand, stability scale, Y-axis `−£`, first-day cumulative note, net-delta titles, etc.). Residual: **Today P&L** on UKA/EUA in edge cases may still show "—" without prior-day marks — **verify** if still material.

### Original “suggested order” (§192–204)

That list is **largely complete** in code. Remaining: **(5)** NBP backfill is partially addressed by code merge; full Stooq depth remains a **data** concern; **(6)** remains **verify-on-prod** for GB table rows.

### Still explicitly deferred (see §180–188)

Out-of-scope QA (mobile, malformed CSV, clear book, limits, email, non-portfolio routes, full keyboard) — **not** closed by the implementation audit. Do these when preparing a wider release.

### Follow-up checklist

- [ ] Live smoke: Risk toggles + histogram, Optimise 95% vs 99% + stress off, Book close + quick-add, Attribution explained %.
- [ ] Data: confirm N2EX/APX and NBP/deprecated hub **row counts** in Supabase for a 120d window if GB/NBP still look empty.
- [ ] Optional: add **Status** column in this file per line item when you touch code again, or link PRs/commits next to each finding.
