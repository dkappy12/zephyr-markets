# Trader trust — release QA checklist

Use before shipping or when validating desk coherence. For **math invariants, units, and cross-surface numbers**, see [numerical-audit-runbook.md](./numerical-audit-runbook.md). Goal: every primary surface shows **as-of / source**, honest **empty or thin-data** states, and **shared** HIGH/MEDIUM/LOW confidence language ([`lib/reliability/contract.ts`](../lib/reliability/contract.ts), [`lib/portfolio/desk-copy.ts`](../lib/portfolio/desk-copy.ts)).

| Route | Staleness / as-of | Model vs tape (where relevant) | Empty / thin data |
|--------|-------------------|--------------------------------|-------------------|
| `/dashboard/overview` | Physical premium, N2EX/TTF footnotes, wind forecast time | Implied vs N2EX tape; residual vs fundamentals | Loading / missing series |
| `/dashboard/brief` | Reliability strip: hours since `generated_at` | Personalised touchpoints vs generic; premium context in copy | "Brief generating…" only when no row |
| `/dashboard/portfolio/book` | Live marks via tooltips | Glossary tooltips on `—` (missing mark / history) | No positions |
| `/dashboard/portfolio/attribution` | Reliability from envelope + calibration | `PREMIUM_VS_TAPE` intro | No positions |
| `/dashboard/portfolio/risk` | Reliability: VaR **days** band (10/20), coverage % | `RISK_HISTORICAL_NOTE` (historical vs stress) | No history / no positions |
| `/dashboard/portfolio/optimise` | Model quality + reliability fields | `PREMIUM_VS_TAPE` + contract language | Blocked / no alternatives |
| `/dashboard/intelligence/markets` | Stat bar + per-card `fetched_at` / `report_date` | `physical_premium` as-of line; table sources | TTF/MID unavailable |
| `/dashboard/intelligence/weather` | Forecast horizon + `physical_premium` snapshot | Forecast vs solar **outturn**; residual vs tape note | No forecast rows |
| `/dashboard/intelligence/signal-feed` | REMIT age + header footnote; per-card times | Deduped header vs card timestamps | No signals |
| `/dashboard/intelligence/signals` | **Same as Signal feed** (route re-exports [`signal-feed/page.tsx`](../app/dashboard/intelligence/signal-feed/page.tsx)) | Same | Same |

## API responses

- `POST /api/classify-positions`: response includes **`reliability`** envelope (contract fields).
- `GET /api/optimise/recommendations`: response includes **`reliability`** envelope.

## Automated checks

- CI: lint, tests, `quality:reconcile`, `quality:gate` (non-strict on merge; logs metrics) when Supabase secrets are configured — see [`self-improvement-assurance.md`](./self-improvement-assurance.md)).
- Local / release: `npm run trust:report` (optional `--out path.md`).

## Known out-of-scope for this checklist

- Payments, tiers, admin-only tooling.
