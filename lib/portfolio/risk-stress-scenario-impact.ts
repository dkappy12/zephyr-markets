import { normaliseMarketBucket, positionDirectionSign, type PositionRow } from "@/lib/portfolio/book";
import {
  darkSpreadStressDeltaGbpMwh,
  isDarkSpread,
  isSpreadInstrument,
  sparkSpreadStressDeltaGbpMwh,
} from "@/lib/portfolio/spread-marks";

/**
 * Stress test moves in native units, aligned with
 * `PORTFOLIO_STRESS_SCENARIOS` and the Risk page scenario card.
 * GB_power: £/MWh; TTF: EUR/MWh; NBP: p/th; UKA: £/t; EUA: EUR/t (pre-FX).
 */
export type StressScenarioMoves = {
  GB_power: number;
  TTF: number;
  NBP: number;
  UKA: number;
  EUA: number;
};

/**
 * One-day P&L impact of a book under a static stress, same convention as
 * `app/dashboard/portfolio/risk` `calculateScenarioImpact` (plain GB Power uses
 * δ£/MWh × MW; spreads use pre-built Δ spread).
 */
export function calculateScenarioStressImpact(
  moves: StressScenarioMoves,
  positions: PositionRow[],
  gbpEurRate: number,
): { total: number; breakdown: { instrument: string; impact: number }[] } {
  let total = 0;
  const breakdown: { instrument: string; impact: number }[] = [];

  for (const pos of positions) {
    const direction = positionDirectionSign(pos.direction);
    if (direction === 0) continue;
    const size = pos.size ?? 0;
    let positionImpact = 0;
    const market = (pos.market ?? "").toUpperCase().replace(" ", "_");

    if (isSpreadInstrument(pos)) {
      const dS = isDarkSpread(pos)
        ? darkSpreadStressDeltaGbpMwh(
            moves.GB_power,
            moves.TTF,
            gbpEurRate,
          )
        : sparkSpreadStressDeltaGbpMwh(
            moves.GB_power,
            moves.TTF,
            gbpEurRate,
          );
      positionImpact = dS * size * direction;
    } else if (normaliseMarketBucket(pos.market) === "GB_POWER") {
      positionImpact = moves.GB_power * size * direction;
    } else if (market === "TTF") {
      positionImpact = moves.TTF * gbpEurRate * size * direction;
    } else if (market === "NBP") {
      positionImpact = (moves.NBP * size * direction) / 100;
    } else if (market === "UKA") {
      positionImpact = moves.UKA * size * direction;
    } else if (market === "EUA") {
      positionImpact = moves.EUA * gbpEurRate * size * direction;
    }

    total += positionImpact;
    if (positionImpact !== 0) {
      breakdown.push({ instrument: pos.instrument ?? "Position", impact: positionImpact });
    }
  }
  return { total, breakdown };
}
