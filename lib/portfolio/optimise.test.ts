import { describe, expect, it } from "vitest";
import {
  buildHistoricalScenarios,
  nbpEurMwhLevelsToPthByDay,
  optimisePortfolio,
  stressScenarios,
  ttfEurMwhToNbpPth,
} from "@/lib/portfolio/optimise";
import type { PositionRow } from "@/lib/portfolio/book";

describe("optimise NBP historical levels", () => {
  const gbpPerEur = 0.86;

  it("maps flat EUR/MWh NBP levels to flat p/th so day-over-day NBP move is ~0", () => {
    const nbpEur = { "2026-01-01": 40, "2026-01-02": 40, "2026-01-03": 40 };
    const fx: Record<string, number> = {
      "2026-01-01": gbpPerEur,
      "2026-01-02": gbpPerEur,
      "2026-01-03": gbpPerEur,
    };
    const nbpPth = nbpEurMwhLevelsToPthByDay(nbpEur, fx, gbpPerEur);
    const hist = buildHistoricalScenarios({
      powerByDay: { "2026-01-01": 100, "2026-01-02": 100, "2026-01-03": 100 },
      ttfByDayEur: { "2026-01-01": 40, "2026-01-02": 40, "2026-01-03": 40 },
      nbpByDayPth: nbpPth,
      fxByDay: fx,
    });
    expect(hist.length).toBe(2);
    expect(Math.abs(hist[0]!.nbpMovePth)).toBeLessThan(1e-9);
    expect(Math.abs(hist[1]!.nbpMovePth)).toBeLessThan(1e-9);
  });

  it("produces bounded non-zero NBP move when EUR/MWh level steps", () => {
    const nbpEur = { "2026-01-01": 40, "2026-01-02": 45, "2026-01-03": 45 };
    const fx: Record<string, number> = {
      "2026-01-01": gbpPerEur,
      "2026-01-02": gbpPerEur,
      "2026-01-03": gbpPerEur,
    };
    const nbpPth = nbpEurMwhLevelsToPthByDay(nbpEur, fx, gbpPerEur);
    const step =
      ttfEurMwhToNbpPth(45, gbpPerEur) - ttfEurMwhToNbpPth(40, gbpPerEur);
    const hist = buildHistoricalScenarios({
      powerByDay: { "2026-01-01": 100, "2026-01-02": 100, "2026-01-03": 100 },
      ttfByDayEur: { "2026-01-01": 40, "2026-01-02": 45, "2026-01-03": 45 },
      nbpByDayPth: nbpPth,
      fxByDay: fx,
    });
    expect(hist.length).toBe(2);
    expect(hist[0]!.nbpMovePth).toBeCloseTo(step, 5);
    expect(Math.abs(hist[0]!.nbpMovePth)).toBeGreaterThan(0.01);
    expect(Math.abs(hist[0]!.nbpMovePth)).toBeLessThanOrEqual(80);
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
