import Link from "next/link";
import { TopoBackground } from "@/components/ui/TopoBackground";

export default function DocsPage() {
  return (
    <div className="flex min-h-screen flex-col bg-ivory">
      <nav className="sticky top-0 z-50 border-b-[0.5px] border-ivory-border bg-ivory/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-[1100px] items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <Link href="/" className="font-serif text-xl text-ink">
            Zephyr
          </Link>
          <div className="flex items-center gap-6">
            <Link
              href="/login"
              className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-mid transition-colors hover:text-ink"
            >
              Log in
            </Link>
            <Link
              href="/signup"
              className="inline-flex h-8 items-center rounded-[4px] bg-ink px-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-ivory transition-colors hover:bg-[#1f1d1a]"
            >
              Start free
            </Link>
          </div>
        </div>
      </nav>

      <main>
        <section className="relative overflow-hidden border-b-[0.5px] border-ivory-border">
          <div className="pointer-events-none absolute inset-0 z-0 min-h-[320px]">
            <TopoBackground
              className="h-full w-full min-h-[320px]"
              lineOpacity={0.25}
            />
          </div>
          <div className="relative z-10 mx-auto max-w-[1100px] px-4 pb-16 pt-14 sm:px-6 sm:pb-20 sm:pt-16 lg:px-8">
            <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.2em] text-ink-mid">
              API Reference · v1
            </p>
            <h1 className="mt-4 font-serif text-[2rem] font-medium leading-[1.1] tracking-tight text-ink sm:text-5xl">
              Zephyr API
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-relaxed text-ink-mid sm:text-lg">
              Programmatic access to GB power market intelligence. Available on
              the Team plan.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-3 font-mono text-[11px] tabular-nums text-ink-mid">
              <span>3 endpoints live</span>
              <span className="hidden h-3 w-[0.5px] bg-ivory-border sm:block" />
              <span>120 req/min rate limit</span>
            </div>
          </div>
        </section>

        <div className="mx-auto max-w-[1100px] space-y-16 px-4 py-14 sm:px-6 lg:px-8">
          <section>
            <h2 className="font-serif text-2xl text-ink">Authentication</h2>
            <p className="mt-4 max-w-3xl text-sm leading-relaxed text-ink-mid">
              All requests require an API key passed as a request header.
              Generate your key from the Settings page under Plan &amp; API.
            </p>
            <pre className="mt-5 overflow-x-auto rounded-[4px] bg-ink px-4 py-3 font-mono text-[11px] leading-relaxed text-ivory">
              X-API-Key: zk_live_your_key_here
            </pre>
            <p className="mt-5 max-w-3xl text-sm leading-relaxed text-ink-mid">
              Keys are shown once on generation. Store them securely. Revoke and
              regenerate from Settings at any time.
            </p>
          </section>

          <section className="space-y-12">
            <div className="rounded-[4px] border-[0.5px] border-ivory-border bg-card p-6 sm:p-8">
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="font-mono text-sm font-semibold text-ink">
                  GET /api/v1/premium
                </h3>
                <span className="rounded-[3px] border-[0.5px] border-[#1D6B4E]/30 bg-[#1D6B4E]/8 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-[#1D6B4E]">
                  Live
                </span>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-ink-mid">
                Returns the latest physical premium score, SRMC-implied price,
                and market conditions. Updated every 5 minutes.
              </p>
              <p className="mt-4 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-light">
                Example request
              </p>
              <pre className="mt-2 overflow-x-auto rounded-[4px] bg-ink px-4 py-3 font-mono text-[10px] leading-relaxed text-ivory sm:text-[11px]">
                {`curl -H "X-API-Key: zk_live_..." https://zephyr.markets/api/v1/premium`}
              </pre>
              <p className="mt-4 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-light">
                Example response
              </p>
              <pre className="mt-2 overflow-x-auto rounded-[4px] bg-ink px-4 py-3 font-mono text-[10px] leading-relaxed text-ivory sm:text-[11px]">
                {`{
  "data": {
    "premium_score": -4.9,
    "direction": "SOFTENING",
    "implied_price_gbp_mwh": 78.19,
    "market_price_gbp_mwh": 94.27,
    "srmc_gbp_mwh": 99.97,
    "wind_gw": 6.71,
    "solar_gw": 0.0,
    "residual_demand_gw": 15.79,
    "regime": "transitional",
    "calculated_at": "2026-04-19T01:58:47Z"
  },
  "meta": {
    "model_version": "1.2.0",
    "generated_at": "2026-04-19T02:01:44Z",
    "endpoint": "/api/v1/premium"
  }
}`}
              </pre>
            </div>

            <div className="rounded-[4px] border-[0.5px] border-ivory-border bg-card p-6 sm:p-8">
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="font-mono text-sm font-semibold text-ink">
                  GET /api/v1/signals
                </h3>
                <span className="rounded-[3px] border-[0.5px] border-[#1D6B4E]/30 bg-[#1D6B4E]/8 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-[#1D6B4E]">
                  Live
                </span>
              </div>
              <p className="mt-2 text-xs text-ink-mid">
                <span className="font-semibold text-ink">Query params:</span>{" "}
                limit (integer, 1–50, default 10)
              </p>
              <p className="mt-3 text-sm leading-relaxed text-ink-mid">
                Returns the latest REMIT signals scored by Zephyr. Each signal
                represents a generation or interconnector outage with direction
                and confidence scoring.
              </p>
              <p className="mt-4 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-light">
                Example request
              </p>
              <pre className="mt-2 overflow-x-auto rounded-[4px] bg-ink px-4 py-3 font-mono text-[10px] leading-relaxed text-ivory sm:text-[11px]">
                {`curl -H "X-API-Key: zk_live_..." https://zephyr.markets/api/v1/signals?limit=3`}
              </pre>
              <p className="mt-4 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-light">
                Example response
              </p>
              <pre className="mt-2 overflow-x-auto rounded-[4px] bg-ink px-4 py-3 font-mono text-[10px] leading-relaxed text-ivory sm:text-[11px]">
                {`{
  "data": [
    {
      "id": "e1e21761-97a5-418c-b002-6a583d4d5ccf",
      "type": "remit",
      "title": "DRAXX-2 — Generation Outage",
      "description": "DRAXX-2 derated by 645.0MW (645.0MW normal). Unplanned outage from 00:58 UTC 19 Apr to 13:01 UTC 20 Apr.",
      "direction": "bear",
      "source": "Elexon BMRS",
      "confidence": "HIGH",
      "created_at": "2026-04-19T00:26:34Z"
    }
  ],
  "meta": {
    "count": 1,
    "generated_at": "2026-04-19T02:08:05Z",
    "endpoint": "/api/v1/signals"
  }
}`}
              </pre>
            </div>

            <div className="rounded-[4px] border-[0.5px] border-ivory-border bg-card p-6 sm:p-8">
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="font-mono text-sm font-semibold text-ink">
                  GET /api/v1/markets
                </h3>
                <span className="rounded-[3px] border-[0.5px] border-[#1D6B4E]/30 bg-[#1D6B4E]/8 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-[#1D6B4E]">
                  Live
                </span>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-ink-mid">
                Returns the latest snapshot of key market prices across GB power,
                European gas, carbon, and FX.
              </p>
              <p className="mt-4 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-light">
                Example request
              </p>
              <pre className="mt-2 overflow-x-auto rounded-[4px] bg-ink px-4 py-3 font-mono text-[10px] leading-relaxed text-ivory sm:text-[11px]">
                {`curl -H "X-API-Key: zk_live_..." https://zephyr.markets/api/v1/markets`}
              </pre>
              <p className="mt-4 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-light">
                Example response
              </p>
              <pre className="mt-2 overflow-x-auto rounded-[4px] bg-ink px-4 py-3 font-mono text-[10px] leading-relaxed text-ivory sm:text-[11px]">
                {`{
  "data": {
    "n2ex_gbp_mwh": 94.27,
    "ttf_eur_mwh": 42.05,
    "nbp_pence_therm": 95.10,
    "uka_gbp_t": 48.66,
    "eua_eur_t": 76.47,
    "gbp_eur": 0.8717,
    "as_of": "2026-04-19T02:06:30Z"
  },
  "meta": {
    "generated_at": "2026-04-19T02:12:18Z",
    "endpoint": "/api/v1/markets"
  }
}`}
              </pre>
            </div>
          </section>

          <section>
            <h2 className="font-serif text-2xl text-ink">Errors</h2>
            <div className="mt-6 overflow-x-auto rounded-[4px] border-[0.5px] border-ivory-border">
              <table className="w-full min-w-[480px] text-left text-sm text-ink-mid">
                <tbody>
                  <tr className="border-b-[0.5px] border-ivory-border">
                    <th className="w-24 px-4 py-3 font-mono text-xs font-semibold text-ink">
                      401
                    </th>
                    <td className="px-4 py-3">
                      Missing or invalid API key
                    </td>
                  </tr>
                  <tr className="border-b-[0.5px] border-ivory-border">
                    <th className="px-4 py-3 font-mono text-xs font-semibold text-ink">
                      403
                    </th>
                    <td className="px-4 py-3">
                      Plan does not include API access
                    </td>
                  </tr>
                  <tr className="border-b-[0.5px] border-ivory-border">
                    <th className="px-4 py-3 font-mono text-xs font-semibold text-ink">
                      429
                    </th>
                    <td className="px-4 py-3">
                      Rate limit exceeded (120 requests per minute)
                    </td>
                  </tr>
                  <tr>
                    <th className="px-4 py-3 font-mono text-xs font-semibold text-ink">
                      500
                    </th>
                    <td className="px-4 py-3">Internal server error</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h2 className="font-serif text-2xl text-ink">Rate limits</h2>
            <p className="mt-4 max-w-3xl text-sm leading-relaxed text-ink-mid">
              Team plan keys are limited to 120 requests per minute. Exceeding
              this returns a 429 response. The limit resets on a rolling
              60-second window.
            </p>
          </section>
        </div>
      </main>

      <footer className="border-t-[0.5px] border-ivory-border py-10">
        <div className="mx-auto flex max-w-[1100px] flex-col items-center justify-center gap-3 px-4 text-center sm:px-6 lg:px-8">
          <a
            href="#meridian"
            className="mb-1 font-mono text-[9px] uppercase tracking-[0.12em] text-ink-light/60 transition-colors hover:text-ink-light"
          >
            Powered by Meridian
          </a>
          <p className="text-xs text-ink-mid">
            Zephyr Markets © 2026 ·{" "}
            <a
              href="mailto:contact@zephyr.markets"
              className="text-ink-mid underline decoration-ivory-border underline-offset-2 transition-colors hover:text-ink"
            >
              contact@zephyr.markets
            </a>
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
            <Link
              href="/privacy"
              className="text-xs font-medium uppercase tracking-[0.12em] text-ink-mid transition-colors hover:text-ink"
            >
              Privacy
            </Link>
            <Link
              href="/terms"
              className="text-xs font-medium uppercase tracking-[0.12em] text-ink-mid transition-colors hover:text-ink"
            >
              Terms
            </Link>
            <Link
              href="/docs"
              className="text-xs font-medium uppercase tracking-[0.12em] text-ink-mid transition-colors hover:text-ink"
            >
              Docs
            </Link>
            <Link
              href="/login"
              className="text-xs font-medium uppercase tracking-[0.12em] text-ink-mid transition-colors hover:text-ink"
            >
              Log in
            </Link>
            <Link
              href="/signup"
              className="text-xs font-medium uppercase tracking-[0.12em] text-ink-mid transition-colors hover:text-ink"
            >
              Sign up
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
