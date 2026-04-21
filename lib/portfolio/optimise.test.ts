import { describe, expect, it } from "vitest";
import {
  buildHistoricalScenarios,
  nbpLevelsPthByDay,
  optimisePortfolio,
  stressScenarios,
} from "@/lib/portfolio/optimise";
import type { PositionRow } from "@/lib/portfolio/book";

describe("optimise NBP historical levels", () => {
  const gbpPerEur = 0.86;
  const fx = (days: string[]): Record<string, number> =>
    Object.fromEntries(days.map((d) => [d, gbpPerEur]));

  it("passes through NBP p/th levels without scaling (flat in → flat out)", () => {
    const days = ["2026-01-01", "2026-01-02", "2026-01-03"];
    const nbpPth = nbpLevelsPthByDay({
      "2026-01-01": 105,
      "2026-01-02": 105,
      "2026-01-03": 105,
    });
    const hist = buildHistoricalScenarios({
      powerByDay: { "2026-01-01": 100, "2026-01-02": 100, "2026-01-03": 100 },
      ttfByDayEur: { "2026-01-01": 40, "2026-01-02": 40, "2026-01-03": 40 },
      nbpByDayPth: nbpPth,
      fxByDay: fx(days),
    });
    expect(hist.length).toBe(2);
    expect(Math.abs(hist[0]!.nbpMovePth)).toBeLessThan(1e-9);
    expect(Math.abs(hist[1]!.nbpMovePth)).toBeLessThan(1e-9);
  });

  it("preserves raw p/th day-over-day step magnitude (5 p/th in → 5 p/th delta out)", () => {
    const days = ["2026-01-01", "2026-01-02", "2026-01-03"];
    // Realistic NBP p/th levels: +5 p/th step from day 1 to day 2.
    const nbpPth = nbpLevelsPthByDay({
      "2026-01-01": 100,
      "2026-01-02": 105,
      "2026-01-03": 105,
    });
    const hist = buildHistoricalScenarios({
      powerByDay: { "2026-01-01": 100, "2026-01-02": 100, "2026-01-03": 100 },
      ttfByDayEur: { "2026-01-01": 40, "2026-01-02": 45, "2026-01-03": 45 },
      nbpByDayPth: nbpPth,
      fxByDay: fx(days),
    });
    expect(hist.length).toBe(2);
    expect(hist[0]!.nbpMovePth).toBeCloseTo(5, 9);
    expect(hist[1]!.nbpMovePth).toBeCloseTo(0, 9);
  });

  it("caps extreme p/th moves at the historical move cap (80 p/th)", () => {
    const days = ["2026-01-01", "2026-01-02"];
    const nbpPth = nbpLevelsPthByDay({
      "2026-01-01": 100,
      "2026-01-02": 250,
    });
    const hist = buildHistoricalScenarios({
      powerByDay: { "2026-01-01": 100, "2026-01-02": 100 },
      ttfByDayEur: { "2026-01-01": 40, "2026-01-02": 40 },
      nbpByDayPth: nbpPth,
      fxByDay: fx(days),
    });
    expect(hist.length).toBe(1);
    // +150 p/th raw move clamps to HISTORICAL_MOVE_CAPS.nbpMovePth = 80.
    expect(hist[0]!.nbpMovePth).toBe(80);
  });
});

describe("optimisePortfolio empty book", () => {
  it("returns no recommendations when there are no material positions", () => {
    const positions: PositionRow[] = [
      {
        id: "p0",
        user_id: "u",
        created_at: new Date(0).toISOString(),
        direction: "long",
        expiry_date: null,
        instrument: "X",
        instrument_type: "power_forward",
        is_hypothetical: false,
        market: "GB_power",
        size: 0,
        tenor: "prompt",
        trade_price: null,
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
    ];
    const result = optimisePortfolio({
      positions,
      scenarios: [...stressScenarios()],
      gbpPerEur: 0.86,
      objective: "cvar",
      confidence: 0.95,
      maxTrades: 3,
      includeStress: true,
    });
    expect(result.recommendations).toEqual([]);
    expect(result.alternatives).toEqual([]);
    expect(result.diagnostics.noAction).toBe(true);
    expect(result.diagnostics.noActionReason).toBe("No open positions to hedge.");
    expect(result.diagnostics.candidatePackageCount).toBe(0);
  });
});

describe("optimisePortfolio NBP tail-risk is reachable", () => {
  /**
   * Regression for #10: before the trade-cost re-scale, NBP hedges were
   * penalised ~1000× too heavily (size × 0.0006 × 1000, with size in
   * therms). An NBP-dominated book would therefore never see NBP appear in
   * the recommendations or alternatives even when it was the single
   * largest tail-risk leg. This test locks in that it does now.
   */
  it("proposes an NBP hedge for a book whose tail risk is dominated by NBP", () => {
    const position: PositionRow = {
      id: "nbp-heavy",
      user_id: "u",
      created_at: new Date(0).toISOString(),
      direction: "long",
      expiry_date: null,
      instrument: "NBP Month+1",
      instrument_type: "gas_forward",
      is_hypothetical: false,
      market: "NBP",
      size: 200_000,
      tenor: "M+1",
      trade_price: 100,
      unit: "therm",
      currency: "GBP",
      source: "test",
      notes: null,
      is_closed: false,
      close_price: null,
      close_date: null,
      entry_date: null,
      raw_csv_row: null,
    };
    const result = optimisePortfolio({
      positions: [position],
      scenarios: [...stressScenarios()],
      gbpPerEur: 0.86,
      objective: "cvar",
      confidence: 0.95,
      maxTrades: 3,
      includeStress: true,
    });
    const allTrades = [
      ...result.recommendations.map((r) => r.instrument),
      ...result.alternatives.flatMap((a) => a.trades.map((t) => t.market)),
    ];
    expect(allTrades).toContain("NBP");
  });
});
