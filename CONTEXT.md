# Zephyr Markets — Project Context

## Company and Product
- Company: Zephyr Markets
- Product: Zephyr
- Domain: zephyr.markets
- Tagline: The physical world, translated into financial intelligence.
- Target: GB and Northwest European power and gas traders

## What Zephyr Does
Zephyr is a portfolio intelligence platform focused on **GB and Northwest European power** (with gas benchmarks for context). It monitors REMIT, weather-driven fundamentals, market tape, and desk-relevant signals — and translates them into a trader’s book: live P&L attribution by physical driver, **physical premium** (implied vs market), risk (VaR/CVaR), optimisation suggestions, and a daily morning brief. Depth on power first; additional markets only when data and maintenance allow.

## Tech Stack
- Frontend: Next.js App Router, TypeScript, Tailwind CSS
- Database/Auth: Supabase (PostgreSQL, RLS, Realtime)
- Backend: Python on Railway (4 agents)
- AI: Claude API (Sonnet) for signal parsing, synthesis, morning brief
- Mapping: Mapbox GL JS
- Payments: Stripe
- Email: Resend
- Alerts: Slack webhooks
- DNS: Cloudflare

## Design System — CRITICAL, apply everywhere
### Colours (use these exact values, never defaults)
- Background (ivory): #F5F0E8 — use EVERYWHERE instead of white
- Secondary surface (ivory-dark): #EDE7D9
- Border (ivory-border): #D9D2C4 — all borders at 0.5px
- Card surface: #FDFBF7
- Primary text (ink): #2C2A26
- Secondary text (ink-mid): #6B6760
- Tertiary text (ink-light): #9E9890
- Bullish (bull): #1D6B4E
- Bearish (bear): #9B3D20
- Watch (watch): #8C5A0E
- Gold (physical premium): #8C6D1F

### Typography
- Cormorant Garamond (serif, Google Fonts): headings, large metric numbers, wordmark, morning brief body
- DM Sans (sans-serif, Google Fonts): navigation, body text, labels, badges, buttons, timestamps
- NEVER use system fonts, Inter, Roboto, or Arial

### Component rules
- Cards: 4px border radius, 0.5px border in #D9D2C4, background #FDFBF7, NO shadows ever
- Metric cards: 3px border radius, background #EDE7D9
- Badges: 2px border radius, 9px uppercase DM Sans with letter spacing
- Signal card left border: 2px — bull green bullish, bear terracotta bearish, watch amber neutral
- Primary buttons: #2C2A26 background, ivory text, crossfade hover 200ms
- No shadows, no gradients, no dark backgrounds anywhere

### Aesthetic
Neoclassical and mathematical. Feels like a 19th century cartographic atlas meets a precision financial instrument. Nothing generic. Authority through restraint.

## Navigation Structure
Primary: Overview | Intelligence | Portfolio | Brief | Settings
Intelligence secondary: Signal Feed | Weather | Markets (and related intelligence routes)
Portfolio secondary: Book | Attribution | Risk | Optimise

## Pricing Tiers
- Free: £0 — 2hr delayed signals, 08:00 brief, GB Power and NBP only, no portfolio
- Pro: £39/month — real-time, 06:00 brief, 5 markets, 30 positions, full intelligence
- Team: £149/month — 5 seats, unlimited positions, all markets, API access
- Enterprise: Custom

## Key Features
1. Signal Feed — AI-interpreted physical events, real-time for Pro
2. Physical Premium Score — gap between market-implied and physically-implied GB power price (gold treatment)
3. P&L Attribution — portfolio P&L decomposed by physical driver (waterfall chart)
4. Risk Engine — VaR, CVaR, scenario heatmap
5. Optimisation — three specific hedge recommendations
6. Morning Brief — 06:00 GMT daily, personalised to trader's book
7. Overview desk — GB wind (model), residual demand, N2EX/TTF tape context, REMIT counts, solar outturn (where pipeline feeds data)

## Database Tables (Supabase)
profiles, positions, signals, alerts, portfolio_pnl, teams, team_members, team_invitations, premium_predictions, attribution_predictions, scenario_predictions, signal_predictions, accuracy_metrics, model_versions, admin_job_log, organisation_themes

## Admin Layer
- Admin role set directly in Supabase database only
- /admin/* routes silently redirect non-admins to dashboard
- Admin pages: Overview, Model Accuracy, User Analytics, Trade Analytics, Data Pipeline, Signal Quality, Infrastructure, System Logs, Nightly Job Log
- Account deletion lifecycle events (start/success/failure) are written to `admin_job_log` by `DELETE /api/account/delete` for operational auditing.

## Accuracy Logging
Every intelligence output is logged as a prediction. Nightly at 22:00 GMT a Railway job records actual market outcomes, updates Bayesian coefficients, and recalculates accuracy metrics. Fully autonomous — no human intervention required.

## Logo System
- Primary: wireframe mesh bust (large format)
- Small format icon: Z lettermark in Cormorant Garamond, charcoal on ivory
- Banner: wireframe mountain range (LinkedIn, backgrounds)
- Compass rose: decorative element inside product (e.g. weather page)

## Quality checks (local & CI)
- CI runs benchmark reconcile (no secrets) plus the **strict** economic quality gate when `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_URL` are set in GitHub Actions (fork PRs skip the gate step).
- Local one-shot before release: `npm run quality:ci` (gate runs only if those env vars are set locally). Release artifact: `npm run trust:report -- --out trust-report.md`.
- Details: [docs/self-improvement-assurance.md](docs/self-improvement-assurance.md). Desk QA: [docs/trader-trust-checklist.md](docs/trader-trust-checklist.md).