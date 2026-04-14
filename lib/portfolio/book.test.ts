import { describe, expect, it } from "vitest";
import {
  MWH_TO_THERM,
  eurMwhPnlToGbp,
  linearPnl,
  ttfToNbpPencePerTherm,
} from "@/lib/portfolio/book";

/** Same formula as `scripts/model-benchmark-reconcile.mjs` benchmark column. */
function benchmarkNbpPencePerTherm(ttfEurMwh: number, gbpPerEur: number) {
  return ((ttfEurMwh * gbpPerEur) / MWH_TO_THERM) * 100;
}

describe("book.ts NBP / P&L parity", () => {
  it("matches model-benchmark-reconcile fixtures (TTF → p/th)", () => {
    const fixtures = [
      { ttf: 10, gbpPerEur: 0.86 },
      { ttf: 42.5, gbpPerEur: 0.86 },
      { ttf: 68.1, gbpPerEur: 0.87 },
    ];
    const tol = 1e-6;
    for (const f of fixtures) {
      const lib = ttfToNbpPencePerTherm(f.ttf, f.gbpPerEur);
      const bench = benchmarkNbpPencePerTherm(f.ttf, f.gbpPerEur);
      expect(Math.abs(lib - bench)).toBeLessThanOrEqual(tol);
    }
  });

  it("linearPnl long and short", () => {
    expect(linearPnl("long", 100, 110, 2)).toBe(20);
    expect(linearPnl("short", 100, 110, 2)).toBe(-20);
    expect(linearPnl(null, 1, 2, 1)).toBeNull();
  });

  it("eurMwhPnlToGbp scales EUR P&L by gbpPerEur", () => {
    expect(eurMwhPnlToGbp("long", 50, 55, 10, 0.86)).toBeCloseTo(43, 10);
  });
});
