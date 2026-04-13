import type { PositionRow } from "@/lib/portfolio/book";
import {
  buildHistoricalScenarios,
  optimisePortfolio,
  stressScenarios,
} from "@/lib/portfolio/optimise";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Optimise regression failed: ${message}`);
}

function fixturePositions(): PositionRow[] {
  return [
    {
      id: "p1",
      user_id: "u",
      created_at: new Date(0).toISOString(),
      direction: "long",
      expiry_date: null,
      instrument: "UK Baseload",
      instrument_type: "power_forward",
      is_hypothetical: false,
      market: "GB_power",
      size: 120,
      tenor: "M+1",
      trade_price: 95,
      unit: "MW",
      currency: "GBP",
      source: "test",
      notes: null,
      is_closed: false,
      close_price: null,
      close_date: null,
      entry_date: null,
      raw_csv_row: null,
    },
    {
      id: "p2",
      user_id: "u",
      created_at: new Date(0).toISOString(),
      direction: "long",
      expiry_date: null,
      instrument: "TTF",
      instrument_type: "gas_forward",
      is_hypothetical: false,
      market: "TTF",
      size: 60,
      tenor: "M+1",
      trade_price: 42,
      unit: "MW",
      currency: "EUR",
      source: "test",
      notes: null,
      is_closed: false,
      close_price: null,
      close_date: null,
      entry_date: null,
      raw_csv_row: null,
    },
  ];
}

/**
 * Lightweight deterministic checks for optimiser behavior.
 * Call manually from a dev shell using ts-node/tsx if desired.
 */
export function runOptimiseRegressionChecks(): void {
  const historical = buildHistoricalScenarios({
    powerByDay: { "2026-01-01": 100, "2026-01-02": 115, "2026-01-03": 110 },
    ttfByDayEur: { "2026-01-01": 40, "2026-01-02": 44, "2026-01-03": 43 },
    nbpByDayPth: { "2026-01-01": 105, "2026-01-02": 112, "2026-01-03": 108 },
  });
  assert(historical.length === 2, "historical scenario count should be stable");

  const result = optimisePortfolio({
    positions: fixturePositions(),
    scenarios: [...historical, ...stressScenarios()],
    gbpPerEur: 0.86,
    objective: "cvar",
    confidence: 0.95,
    maxTrades: 3,
    includeStress: true,
  });

  assert(result.before.cvarLoss >= 0, "before CVaR should be non-negative loss metric");
  assert(
    result.after.cvarLoss <= result.before.cvarLoss,
    "best package should not worsen CVaR versus no-trade baseline",
  );
  assert(
    result.diagnostics.candidatePackageCount > 0,
    "candidate package generation should produce search space",
  );
}
