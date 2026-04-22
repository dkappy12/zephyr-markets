# Human pass (Playwright MCP) — 2026-04-22

**Tool:** Cursor `user-playwright` MCP against **production** `https://zephyr.markets/`.  
**Scope:** public marketing surface + auth boundary; **not** a substitute for a logged-in desk review.

## What ran (automated)

1. **GET `/` (home)**  
   - Live physical strip: implied vs N2EX, wind GW, residual GW, unplanned REMIT MW, regime label.  
   - Marketing signal cards show MW offline and **~£/MWh estimated price impact** on sample REMIT events (consistent “physics story” for a prospect page).

2. **GET `/login`**  
   - Form: `Email`, `Password`, **Sign in**, links to forgot password, signup.  
   - Suitable for the same `E2E_TEST_EMAIL` / `E2E_TEST_PASSWORD` flow as [`e2e/auth-smoke.spec.ts`](../e2e/auth-smoke.spec.ts).

3. **GET `/dashboard/portfolio/optimise` (unauthenticated)**  
   - Redirects to:  
   - `/login?returnUrl=%2Fdashboard%2Fportfolio%2Foptimise`  
   - **OK:** `returnUrl` is preserved for post-login return.

## What did **not** run (blocked)

- **Signed-in** Book, Risk (120d), Optimise, **Attribution** with your live data.  
- **Reason:** the agent environment had **no** `E2E_TEST_EMAIL` or `E2E_TEST_PASSWORD` in the shell, and we **do not** read or store live passwords in the repo.  
- The Playwright MCP browser session is **not** your personal Chrome profile (no saved session cookies from your day-to-day browser).

## How to complete the authenticated pass

**Option A — Environment variables (automation-friendly)**  
1. Use a **dedicated** account (recommended in [`e2e/README.md`](../e2e/README.md)), not a production personal account, if the flow ever scripts destructive steps. For read-only pages, a low-privilege account is still safer than an admin.  
2. In the **same** environment the automation uses, set:  
   - `E2E_TEST_EMAIL`  
   - `E2E_TEST_PASSWORD`  
3. Re-run a Playwright or MCP pass that fills `/login` and then navigates to `returnUrl` or manually to:  
   - `/dashboard/portfolio/book`  
   - `/dashboard/portfolio/risk` (set lookback to **120d** when comparing to Optimise)  
   - `/dashboard/portfolio/optimise`  
   - `/dashboard/portfolio/attribution`  

**Option B — Manual 15 minutes (highest “trader trust” value)**  
 walk those routes yourself, note anything odd, and paste bullets into a new dated `numerical-audit-findings-*.md` or chat.

**Option C — Playwright in repo (local/staging/ prod)**  
```bash
set PLAYWRIGHT_BASE_URL=https://zephyr.markets
set E2E_TEST_EMAIL=...
set E2E_TEST_PASSWORD=...
npm run test:e2e
```  
(Adjust for PowerShell: `$env:PLAYWRIGHT_BASE_URL=...`.) The existing smoke only asserts login + settings; it does not walk portfolio. Extend a spec or use MCP for Book/Risk/Optimise/Attribution when env is set.

## Security

- **Never** commit real passwords.  
- Prefer **dedicated** E2E users and rotate if ever logged in docs or CI logs.

## Verdict (this run)

| Area | Result |
|------|--------|
| Public + auth redirect + `returnUrl` | **Plausible, coherent** for trust at the marketing/auth shell |
| In-app numbers with **your** book | **Not audited** in this run — do Option A, B, or C |

See also: [`numerical-audit-findings-2026-04-22.md`](./numerical-audit-findings-2026-04-22.md) (static audit) and [`numerical-audit-runbook.md`](./numerical-audit-runbook.md).
