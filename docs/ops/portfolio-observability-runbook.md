# Portfolio observability — runbook & alerting hints

**CI / local:** GitHub Actions (`.github/workflows/ci.yml`) runs `npm ci`, `npm run lint`, `npm test`, and `npm run build` on pushes and pull requests to `main`. Locally, `npm test` runs Vitest on `lib/**/*.test.ts` (health response shape, personalise guardrails, `PORTFOLIO_API_LOG_EVENTS`).

Operational reference for **`/api/health`** portfolio probes and structured **`portfolio_api`** logs (stdout JSON via `lib/ops/logger.ts`). Pair with **`auth_audit_log`** in Supabase for events that also call `logAuthAuditEvent`.

---

## `/api/health`

| Field | Meaning |
| --- | --- |
| `ok` | `false` when feed **error** thresholds hit **or** `portfolioDataPlane` tables fail |
| `checks.supabase` | `"ok"` when admin DB ping succeeds |
| `checks.portfolioFeeds` | `"ok"` \| `"warn"` \| `"error"` — stale market data |
| `checks.portfolioTables` | `"ok"` \| `"error"` — `portfolio_pnl` / `positions` reachable with service role |
| `portfolioDataPlane.portfolioPnl` | `"ok"` \| `"error"` |
| `portfolioDataPlane.positions` | `"ok"` \| `"error"` |
| `feedHealth.warnings` | Human-readable strings for feeds and table probes |

### When `ok` is false or `portfolioTables` is error

1. Confirm **`NEXT_PUBLIC_SUPABASE_URL`** / **`SUPABASE_SERVICE_ROLE_KEY`** on the deployment.
2. In Supabase SQL: verify tables **`portfolio_pnl`** and **`positions`** exist and service role can `select` (health uses limit 1).
3. Check **`feedHealth.warnings`** for power/gas/fx/carbon staleness (upstream loaders).

### Synthetic / uptime monitors

Point an external checker at **`GET /api/health`** on the production domain. Alert when HTTP status ≠ 200 or JSON `ok !== true`.

### Example Datadog Log Explorer (structured stdout)

Logs are JSON lines; filter on the logger payload:

- `scope:portfolio_api` OR search raw string `"scope":"portfolio_api"`

---

## `scope: portfolio_api` events

Emitted with `event` / `level` / `data` alongside `ts`. Use these names in monitors (rate or existence).

| Event | Level | Typical cause |
| --- | --- | --- |
| `attribution_snapshot_upsert_failed` | error | `portfolio_pnl` upsert failure after attribution POST |
| `import_position_count_failed` | error | Position count query failed during import (billing cap path) |
| `import_insert_failed` | error | Bulk insert failed after CSV validation passed |
| `optimise_data_load_failed` | error | Positions/market_prices/gas_prices/fx_rates load error in optimise GET |
| `optimise_recommendations_exception` | error | Uncaught exception in optimise handler |

Related **`auth_audit`** events (stored in **`auth_audit_log`**):  
`portfolio_attribution_snapshot_failed`, `portfolio_import_position_count_failed`, `portfolio_import_failed`, `optimise_recommendations_data_load_failed`, `optimise_recommendations_failed`.

---

## Slack (optional)

If **`SLACK_WEBHOOK_URL`** is set, **`sendOpsAlert`** (`lib/ops/alerts.ts`) can notify on specific failure paths — today used mainly when audit writes fail; new portfolio logs are stdout-first for aggregation tools.

---

## CSRF / same-origin policy (portfolio & optimise)

Stateful **POST** routes use **`assertSameOrigin`**. Sensitive **GET** endpoints that return user-specific data under the session cookie also require **`Origin`** or **`Referer`** matching the app origin: **`GET /api/portfolio/export`**, **`GET /api/optimise/recommendations`**. Scripted calls without those headers receive **403** — use same-origin **`fetch`** from the dashboard (relative URLs).
