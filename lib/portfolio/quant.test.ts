import { describe, expect, it } from "vitest";
import {
  attributionTtfToNbpPencePerTherm,
} from "@/lib/portfolio/attribution";
import { ttfToNbpPencePerTherm } from "@/lib/portfolio/book";
import { optimisePortfolio, type Scenario } from "@/lib/portfolio/optimise";
import type { PositionRow } from "@/lib/portfolio/book";

function fixturePosition(): PositionRow {
  return {
    id: "1",
    user_id: "u",
    created_at: new Date(0).toISOString(),
    direction: "long",
    expiry_date: null,
    instrument: "GB Base",
    instrument_type: "power_forward",
    is_hypothetical: false,
    market: "GB_power",
    size: 1,
    tenor: "M+1",
    trade_price: 100,
    unit: "MW",
    currency: "GBP",
    source: "test",
    notes: null,
    is_closed: false,
    close_price: null,
    close_date: null,
    entry_date: null,
    raw_csv_row: null,
  };
}

describe("quant reliability guards", () => {
  it("uses the same NBP conversion in attribution and book", () => {
    const ttf = 42.5;
    expect(attributionTtfToNbpPencePerTherm(ttf)).toBeCloseTo(
      ttfToNbpPencePerTherm(ttf),
      10,
    );
  });

  it("keeps empirical VaR/CVaR separate from stress scenarios", () => {
    const scenarios: Scenario[] = [
      { id: "h1", label: "h1", source: "historical", gbPowerMove: 10, ttfMoveEurMwh: 0, nbpMovePth: 0 },
      { id: "h2", label: "h2", source: "historical", gbPowerMove: 20, ttfMoveEurMwh: 0, nbpMovePth: 0 },
      { id: "s1", label: "s1", source: "stress", gbPowerMove: -100, ttfMoveEurMwh: 0, nbpMovePth: 0 },
    ];
    const out = optimisePortfolio({
      positions: [fixturePosition()],
      scenarios,
      gbpPerEur: 0.86,
      objective: "cvar",
      confidence: 0.95,
      maxTrades: 1,
      includeStress: true,
    });
    // Historical outcomes are gains, so empirical loss metrics stay <= 0.
    expect(out.before.varLoss).toBeLessThanOrEqual(0);
    expect(out.before.cvarLoss).toBeLessThanOrEqual(0);
    // Stress suite still captures adverse tail separately.
    expect(out.before.worstStressLoss).toBeCloseTo(100, 6);
  });
});
