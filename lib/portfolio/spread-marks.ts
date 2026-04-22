/**
 * Clean spark and dark spread marks in £/MWh, aligned with the Intelligence
 * → Markets page (`srmcGbpMwh`, `coalSrmcGbpMwh`) so Book/Risk/Attribution
 * price spark/dark spread legs consistently with the desk view.
 */
import { linearPnl, type LivePrices, type PositionRow } from "@/lib/portfolio/book";

const CCGT_ELECTRIC_EFF = 0.5;
/** UKA + CPS stack (£/MWh electric) in SRMC — matches `markets/page` CARBON_ADDER. */
const CARBON_ADDER = 26;
const VOM = 2;
const CO2_INTENSITY = 0.9;
const CO2_PRICE = 71;
const COAL_EFF = 0.36;

function gasGbpPerMwhThermal(ttfEur: number, gbpPerEur: number): number {
  return ttfEur * gbpPerEur;
}

function gasGbpPerMwhElectric(ttfEur: number, gbpPerEur: number): number {
  return gasGbpPerMwhThermal(ttfEur, gbpPerEur) / CCGT_ELECTRIC_EFF;
}

function srmcGbpMwh(ttfEur: number, gbpPerEur: number): number {
  return gasGbpPerMwhElectric(ttfEur, gbpPerEur) + CARBON_ADDER + VOM;
}

function coalSrmcGbpMwh(ttfEur: number, gbpPerEur: number): number {
  return (
    gasGbpPerMwhThermal(ttfEur, gbpPerEur) / COAL_EFF +
    CO2_INTENSITY * CO2_PRICE +
    VOM
  );
}

/** Clean spark: N2EX (GBP/MWh) − SRMC(TTF). */
export function sparkSpreadGbpMwh(
  n2exGbpMwh: number,
  ttfEurMwh: number,
  gbpPerEur: number,
): number {
  return n2exGbpMwh - srmcGbpMwh(ttfEurMwh, gbpPerEur);
}

/** Dark spread: N2EX − coal SRMC(TTF). */
export function darkSpreadGbpMwh(
  n2exGbpMwh: number,
  ttfEurMwh: number,
  gbpPerEur: number,
): number {
  return n2exGbpMwh - coalSrmcGbpMwh(ttfEurMwh, gbpPerEur);
}

/**
 * First-order £/MWh change in a clean spark for a desk-style stress where
 * `dN2exGbpMwh` and `dTtfEurMwh` are additive to N2ex and TTF, using `ttfRefEurMwh`
 * as the pre-shock TTF (€/MWh) for SRMC curvature.
 */
export function sparkSpreadStressDeltaGbpMwh(
  dN2exGbpMwh: number,
  dTtfEurMwh: number,
  gbpPerEur: number,
  ttfRefEurMwh = 50,
): number {
  const s0 = srmcGbpMwh(ttfRefEurMwh, gbpPerEur);
  const s1 = srmcGbpMwh(ttfRefEurMwh + dTtfEurMwh, gbpPerEur);
  return dN2exGbpMwh - (s1 - s0);
}

export function darkSpreadStressDeltaGbpMwh(
  dN2exGbpMwh: number,
  dTtfEurMwh: number,
  gbpPerEur: number,
  ttfRefEurMwh = 50,
): number {
  const c0 = coalSrmcGbpMwh(ttfRefEurMwh, gbpPerEur);
  const c1 = coalSrmcGbpMwh(ttfRefEurMwh + dTtfEurMwh, gbpPerEur);
  return dN2exGbpMwh - (c1 - c0);
}

export function isSparkSpread(p: Pick<PositionRow, "instrument_type">): boolean {
  return (p.instrument_type ?? "").toLowerCase() === "spark_spread";
}

export function isDarkSpread(p: Pick<PositionRow, "instrument_type">): boolean {
  return (p.instrument_type ?? "").toLowerCase() === "dark_spread";
}

export function isSpreadInstrument(
  p: Pick<PositionRow, "instrument_type">,
): boolean {
  return isSparkSpread(p) || isDarkSpread(p);
}

type SpreadTime = "current" | "open";

/**
 * N2ex and TTF marks for one session leg (day-ahead for current, first
 * on-day print for "open" where LivePrices carries both).
 */
function n2exTtf(
  lp: LivePrices,
  which: SpreadTime,
): { n2ex: number | null; ttf: number | null; gbpPerEur: number } {
  const n2ex =
    which === "current" ? lp.gbPowerGbpMwh : lp.gbPowerOpenGbpMwh;
  const ttf =
    which === "current" ? lp.ttfEurMwh : lp.ttfOpenEurMwh;
  return {
    n2ex,
    ttf,
    gbpPerEur: lp.gbpPerEur,
  };
}

/**
 * Mark of the clean spark or dark spread in £/MWh, or null if any input missing.
 */
export function spreadMarkGbpMwh(
  p: Pick<PositionRow, "instrument_type">,
  lp: LivePrices,
  which: SpreadTime,
): number | null {
  if (!isSpreadInstrument(p)) return null;
  const { n2ex, ttf, gbpPerEur } = n2exTtf(lp, which);
  if (
    n2ex == null ||
    ttf == null ||
    !Number.isFinite(n2ex) ||
    !Number.isFinite(ttf) ||
    !Number.isFinite(gbpPerEur)
  ) {
    return null;
  }
  return isDarkSpread(p)
    ? darkSpreadGbpMwh(n2ex, ttf, gbpPerEur)
    : sparkSpreadGbpMwh(n2ex, ttf, gbpPerEur);
}

/** Intraday P&amp;L for a spread: open mark → current mark, £ for MW. */
export function spreadIntradayPnlGbp(
  p: Pick<PositionRow, "direction" | "size" | "instrument_type">,
  lp: LivePrices,
): number | null {
  const opn = spreadMarkGbpMwh(p, lp, "open");
  const cur = spreadMarkGbpMwh(p, lp, "current");
  if (opn == null || cur == null) return null;
  return linearPnl(p.direction, opn, cur, p.size);
}

/**
 * Total P&amp;L for a spread: entry (trade) spread in £/MWh vs current mark.
 */
export function spreadTotalPnlGbp(
  p: Pick<PositionRow, "direction" | "size" | "instrument_type" | "trade_price">,
  lp: LivePrices,
): number | null {
  const cur = spreadMarkGbpMwh(p, lp, "current");
  if (cur == null || p.trade_price == null || !Number.isFinite(p.trade_price)) {
    return null;
  }
  return linearPnl(p.direction, p.trade_price, cur, p.size);
}

/**
 * Historical: spread in £/MWh from daily N2ex (GBP), TTF (EUR) and daily FX
 * (for SRMC, matching live LivePrices gbp/€ application).
 */
export function historicalSpreadGbpMwh(
  p: Pick<PositionRow, "instrument_type">,
  n2exGbpMwh: number,
  ttfEurMwh: number,
  gbpPerEur: number,
): number | null {
  if (!isSpreadInstrument(p)) return null;
  if (
    !Number.isFinite(n2exGbpMwh) ||
    !Number.isFinite(ttfEurMwh) ||
    !Number.isFinite(gbpPerEur)
  ) {
    return null;
  }
  return isDarkSpread(p)
    ? darkSpreadGbpMwh(n2exGbpMwh, ttfEurMwh, gbpPerEur)
    : sparkSpreadGbpMwh(n2exGbpMwh, ttfEurMwh, gbpPerEur);
}

