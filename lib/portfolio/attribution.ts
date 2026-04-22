import {
  eurMwhPnlToGbp,
  GBP_PER_EUR,
  linearPnl,
  netDeltaMw,
  nbpPnlGbp,
  PositionRow,
  ttfToNbpPencePerTherm,
  type LivePrices,
} from "@/lib/portfolio/book";
import {
  isSpreadInstrument,
  spreadIntradayPnlGbp,
} from "@/lib/portfolio/spread-marks";

/**
 * Fallback EUR→GBP for gas attribution when no live rate is available.
 * Prefer passing the live `LivePrices.gbpPerEur` through to the
 * attribution helpers; this constant is kept only as a last-resort
 * default for legacy call sites.
 */
export const GAS_TTF_GBP_PER_EUR_MWH = GBP_PER_EUR;

/** Canonical NBP conversion shared with Book/Risk/Optimise. */
export const attributionTtfToNbpPencePerTherm = ttfToNbpPencePerTherm;

export function dirMult(direction: string | null): number {
  const d = (direction ?? "").toLowerCase();
  if (d === "long") return 1;
  if (d === "short") return -1;
  return 0;
}

export function isGbPowerMarket(p: PositionRow): boolean {
  if (isSpreadInstrument(p)) return false;
  const m = (p.market ?? "").toLowerCase().replace(/[\s_]/g, "");
  return m === "gbpower" || m === "n2ex" || m === "apx";
}

export function isGasMarket(p: PositionRow): boolean {
  if (isSpreadInstrument(p)) return false;
  const m = (p.market ?? "").toLowerCase().replace(/\s/g, "_");
  return m === "ttf" || m === "nbp" || m === "other_gas";
}

export function isCarbonAllowancePosition(p: PositionRow): boolean {
  const m = (p.market ?? "").toLowerCase().replace(/[\s_]/g, "");
  return m === "uka" || m === "eua";
}

/**
 * Same "Today P&L" as Book table: open → current intraday.
 *
 * Returns null for positions that have no intraday open price (UKA, EUA,
 * OTHER_POWER, OTHER markets) — these are excluded from intraday totals
 * but still counted toward total P&L elsewhere. `totalTodayPnlGbp` sums
 * the non-null values; if a future feed wires intraday opens for those
 * markets, add a branch here and the aggregate will pick them up.
 */
export function positionTodayPnlGbp(
  p: PositionRow,
  lp: LivePrices | null,
): number | null {
  if (!lp) return null;
  if (isSpreadInstrument(p)) {
    return spreadIntradayPnlGbp(p, lp);
  }
  const mlow = (p.market ?? "").toLowerCase().replace(/\s/g, "_");
  if (mlow === "uka") {
    const mark = lp.ukaGbpPerT;
    const open = lp.ukaGbpPerTPrev;
    if (mark == null || open == null) return null;
    return linearPnl(p.direction, open, mark, p.size);
  }
  if (mlow === "eua") {
    const mark = lp.euaEurPerT;
    const open = lp.euaEurPerTPrev;
    if (mark == null || open == null) return null;
    return eurMwhPnlToGbp(
      p.direction,
      open,
      mark,
      p.size,
      lp.gbpPerEur ?? GBP_PER_EUR,
    );
  }
  if (mlow === "nbp") {
    const mark = lp.nbpPencePerTherm;
    const open = lp.nbpOpenPencePerTherm;
    if (mark == null || open == null) return null;
    return nbpPnlGbp(p.direction, open, mark, p.size);
  }
  if (mlow === "ttf") {
    const curE = lp.ttfEurMwh;
    const opE = lp.ttfOpenEurMwh;
    if (curE == null || opE == null) return null;
    return eurMwhPnlToGbp(
      p.direction,
      opE,
      curE,
      p.size,
      lp.gbpPerEur ?? GBP_PER_EUR,
    );
  }
  if (mlow === "other_gas") {
    const unit = (p.unit ?? "").toLowerCase();
    const currency = (p.currency ?? "").toUpperCase();
    if (unit.includes("therm")) {
      const mark = lp.nbpPencePerTherm;
      const open = lp.nbpOpenPencePerTherm;
      if (mark == null || open == null) return null;
      return nbpPnlGbp(p.direction, open, mark, p.size);
    }
    if (currency === "EUR") {
      const curE = lp.ttfEurMwh;
      const opE = lp.ttfOpenEurMwh;
      if (curE == null || opE == null) return null;
      return eurMwhPnlToGbp(
        p.direction,
        opE,
        curE,
        p.size,
        lp.gbpPerEur ?? GBP_PER_EUR,
      );
    }
    const curGbp = lp.ttfGbpMwh;
    const opnGbp = lp.ttfOpenGbpMwh;
    if (curGbp == null || opnGbp == null) return null;
    return linearPnl(p.direction, opnGbp, curGbp, p.size);
  }
  const isGbPwr = isGbPowerMarket(p);
  const cur = isGbPwr ? lp.gbPowerGbpMwh : null;
  const opn = isGbPwr ? lp.gbPowerOpenGbpMwh : null;
  if (cur == null || opn == null) return null;
  return linearPnl(p.direction, opn, cur, p.size);
}

export function totalTodayPnlGbp(
  positions: PositionRow[],
  lp: LivePrices | null,
): number {
  let s = 0;
  for (const p of positions) {
    const v = positionTodayPnlGbp(p, lp);
    if (v != null && Number.isFinite(v)) s += v;
  }
  return s;
}

export function windPriceImpactGbpPerMwh(
  deltaWindGw: number,
  currentWindGw = 8.0,
): number {
  // Piecewise sensitivity matches Python model _wind_price_suppression_gbp_mwh
  // Uses current wind level to determine which segment we're in
  let sensPerGw: number;
  if (currentWindGw <= 5) sensPerGw = 2.5;
  else if (currentWindGw <= 15) sensPerGw = 1.8;
  else sensPerGw = 3.5;
  return deltaWindGw * sensPerGw;
}

export function windAttributionForPosition(
  deltaWindGw: number,
  p: PositionRow,
  currentWindGw = 8.0,
): number {
  if (!isGbPowerMarket(p)) return 0;
  const dm = dirMult(p.direction);
  if (dm === 0) return 0;
  const sz = Number(p.size);
  if (!Number.isFinite(sz)) return 0;
  return windPriceImpactGbpPerMwh(deltaWindGw, currentWindGw) * sz * dm;
}

/** REMIT sensitivity is state-dependent based on residual demand segment slope. */
export function remitPriceImpactGbpPerMwh(
  deltaRemitMw: number,
  residualDemandGw = 22.0,
): number {
  // Slope matches Python model _residual_demand_premium_gbp_mwh breakpoints
  let slopePerGw: number;
  if (residualDemandGw <= 20) slopePerGw = 0.0;
  else if (residualDemandGw <= 28) slopePerGw = 0.5;
  else if (residualDemandGw <= 32) slopePerGw = 1.5;
  else if (residualDemandGw <= 35) slopePerGw = 5.0;
  else slopePerGw = 20.0;
  return (deltaRemitMw / 1000) * slopePerGw;
}

export function remitAttributionForPosition(
  deltaRemitMw: number,
  p: PositionRow,
  residualDemandGw = 22.0,
): number {
  if (!isGbPowerMarket(p)) return 0;
  const pip = remitPriceImpactGbpPerMwh(deltaRemitMw, residualDemandGw);
  const dm = dirMult(p.direction);
  if (dm === 0) return 0;
  const sz = Number(p.size);
  if (!Number.isFinite(sz)) return 0;
  return pip * sz * dm;
}

export function gasAttributionForPosition(
  ttfStart: number,
  ttfCurrent: number,
  p: PositionRow,
  gbpPerEur: number = GAS_TTF_GBP_PER_EUR_MWH,
): number {
  if (!isGasMarket(p)) return 0;
  const dm = dirMult(p.direction);
  if (dm === 0) return 0;
  const sz = Number(p.size);
  if (!Number.isFinite(sz)) return 0;
  const m = (p.market ?? "").toLowerCase().replace(/\s/g, "_");
  const deltaTtf = ttfCurrent - ttfStart;
  if (m === "ttf" || m === "other_gas") {
    return deltaTtf * gbpPerEur * sz * dm;
  }
  if (m === "nbp") {
    const pStart = attributionTtfToNbpPencePerTherm(ttfStart, gbpPerEur);
    const pEnd = attributionTtfToNbpPencePerTherm(ttfCurrent, gbpPerEur);
    return nbpPnlGbp(p.direction, pStart, pEnd, sz) ?? 0;
  }
  return 0;
}

export function sumWindAttribution(
  positions: PositionRow[],
  deltaWindGw: number,
  currentWindGw = 8.0,
): number {
  let s = 0;
  for (const p of positions) {
    s += windAttributionForPosition(deltaWindGw, p, currentWindGw);
  }
  return s;
}

export function sumGasAttribution(
  positions: PositionRow[],
  ttfStart: number | null,
  ttfCurrent: number | null,
  gbpPerEur: number = GAS_TTF_GBP_PER_EUR_MWH,
): number {
  if (
    ttfStart == null ||
    ttfCurrent == null ||
    !Number.isFinite(ttfStart) ||
    !Number.isFinite(ttfCurrent)
  ) {
    return 0;
  }
  let s = 0;
  for (const p of positions) {
    s += gasAttributionForPosition(ttfStart, ttfCurrent, p, gbpPerEur);
  }
  return s;
}

export function sumRemitAttribution(
  positions: PositionRow[],
  deltaRemitMw: number,
  residualDemandGw = 22.0,
): number {
  let s = 0;
  for (const p of positions) {
    s += remitAttributionForPosition(deltaRemitMw, p, residualDemandGw);
  }
  return s;
}

/** GB Power MW net only (for alignment / gauge). */
export function netGbPowerSignedMw(positions: PositionRow[]): {
  signedMw: number;
  isMixed: boolean;
} {
  let delta = 0;
  let mwCount = 0;
  for (const p of positions) {
    if (!isGbPowerMarket(p)) continue;
    const u = (p.unit ?? "").toLowerCase();
    if (u !== "mw") continue;
    mwCount++;
    const s = Number(p.size) || 0;
    if (p.direction === "long") delta += s;
    else if (p.direction === "short") delta -= s;
  }
  if (mwCount === 0) {
    return { signedMw: 0, isMixed: true };
  }
  return { signedMw: delta, isMixed: false };
}

export type PhysicalDir = "firming" | "softening";

export function parsePhysicalDirection(
  raw: string | null | undefined,
): PhysicalDir | null {
  const t = (raw ?? "").toLowerCase();
  if (t.includes("firm")) return "firming";
  if (t.includes("soft")) return "softening";
  return null;
}

export function bookAlignmentCopy(
  phys: PhysicalDir | null,
  positions: PositionRow[],
): { text: string; className: string } {
  const gb = netGbPowerSignedMw(positions);
  const terracotta = "text-[#8B3A3A]";
  const green = "text-[#1D6B4E]";
  const mid = "text-ink-mid";

  if (phys == null || gb.isMixed) {
    return { text: "MIXED — check breakdown", className: mid };
  }
  if (gb.signedMw === 0) {
    return { text: "MIXED — check breakdown", className: mid };
  }
  const netLong = gb.signedMw > 0;
  const netShort = gb.signedMw < 0;

  if (phys === "softening") {
    if (netLong) return { text: "BEARISH for your book", className: terracotta };
    if (netShort) return { text: "FAVOURABLE for your book", className: green };
  }
  if (phys === "firming") {
    if (netLong) return { text: "FAVOURABLE for your book", className: green };
    if (netShort) return { text: "BEARISH for your book", className: terracotta };
  }
  return { text: "MIXED — check breakdown", className: mid };
}

/** Uses all MW positions (any market) for “mixed units” labelling — stats bar only. */
export function netPowerLabelForStats(positions: PositionRow[]): ReturnType<
  typeof netDeltaMw
> {
  return netDeltaMw(positions);
}

export function primaryDriverKey(
  wind: number,
  gas: number,
  remit: number,
  residual: number,
  shape = 0,
  demand = 0,
  interconnector = 0,
):
  | "wind"
  | "gas"
  | "remit"
  | "residual"
  | "shape"
  | "demand"
  | "interconnector" {
  const rows: {
    k:
      | "wind"
      | "gas"
      | "remit"
      | "residual"
      | "shape"
      | "demand"
      | "interconnector";
    a: number;
  }[] = [
    { k: "wind", a: Math.abs(wind) },
    { k: "gas", a: Math.abs(gas) },
    { k: "remit", a: Math.abs(remit) },
    { k: "shape", a: Math.abs(shape) },
    { k: "demand", a: Math.abs(demand) },
    { k: "interconnector", a: Math.abs(interconnector) },
    { k: "residual", a: Math.abs(residual) },
  ];
  rows.sort((x, y) => y.a - x.a);
  return rows[0].k;
}

/** Latest physical model row fields used for premium-based attribution. */
export type PhysicalPremiumInput = {
  wind_gw: number | null;
  solar_gw: number | null;
  residual_demand_gw: number | null;
  srmc_gbp_mwh: number | null;
  market_price_gbp_mwh: number | null;
  implied_price_gbp_mwh: number | null;
  premium_value: number | null;
  remit_mw_lost: number | null;
};

const EPS = 1e-6;

/**
 * Intraday GB DA move (£/MWh) from market_prices, else premium/implied gap from physical model.
 */
export function resolveTotalPriceMoveGbpMwh(opts: {
  marketIntradayGbpMwh: number | null;
  physical: PhysicalPremiumInput;
}): number {
  const { marketIntradayGbpMwh: intra, physical } = opts;
  if (
    intra != null &&
    Number.isFinite(intra) &&
    Math.abs(intra) > EPS
  ) {
    return intra;
  }
  const pv = physical.premium_value;
  if (pv != null && Number.isFinite(pv) && Math.abs(pv) > EPS) {
    return pv;
  }
  const mp = physical.market_price_gbp_mwh;
  const ip = physical.implied_price_gbp_mwh;
  if (
    mp != null &&
    ip != null &&
    Number.isFinite(mp) &&
    Number.isFinite(ip)
  ) {
    return mp - ip;
  }
  return 0;
}

export function partitionPriceMoveGbpMwh(
  totalGbpMwh: number,
  p: PhysicalPremiumInput,
): { wind: number; gas: number; remit: number; residual: number } {
  /**
   * Sensitivity-based attribution using the same piecewise coefficients
   * as the physical premium model (v1.2.0).
   *
   * Wind sensitivity: piecewise £/MWh per GW (matches _wind_price_suppression_gbp_mwh)
   * Gas sensitivity: 1/ETA_CCGT = 2.0 (£/MWh per £/MWh TTF move at 50% efficiency)
   * REMIT sensitivity: piecewise based on effective_rd segment slope
   *
   * Each factor's contribution is its sensitivity × its observed move,
   * normalised so contributions sum to totalGbpMwh.
   */
  const windGw = Math.max(0, Number(p.wind_gw) || 0);
  const rdGw = Math.max(0, Number(p.residual_demand_gw) || 0);
  const remitMw = Math.max(0, Number(p.remit_mw_lost) || 0);
  const srmc = Number(p.srmc_gbp_mwh) || 0;
  const mkt = Number(p.market_price_gbp_mwh) || 0;

  // Piecewise wind sensitivity (£/MWh per GW) — matches Python model
  function windSensPerGw(gw: number): number {
    if (gw <= 5) return 2.5;
    if (gw <= 15) return 1.8;
    return 3.5;
  }

  // RD premium slope at current residual demand (£/MWh per GW)
  function rdSlopeAtGw(rd: number): number {
    if (rd <= 20) return 0.0;
    if (rd <= 28) return 0.5;
    if (rd <= 32) return 1.5;
    if (rd <= 35) return 5.0;
    return 20.0;
  }

  // Sensitivity weights (how much each factor explains per unit move)
  const windWeight = windSensPerGw(windGw) * windGw;
  const gasWeight =
    mkt > EPS && srmc > EPS ? Math.min(srmc / mkt, 1) * Math.abs(totalGbpMwh) : 0;
  const remitWeight = rdSlopeAtGw(rdGw) * (remitMw / 1000);

  const totalWeight = windWeight + gasWeight + remitWeight;

  if (totalWeight < EPS || Math.abs(totalGbpMwh) < EPS) {
    return { wind: 0, gas: 0, remit: 0, residual: totalGbpMwh };
  }

  const windMove = (windWeight / totalWeight) * totalGbpMwh;
  const gasMove = (gasWeight / totalWeight) * totalGbpMwh;
  const remitMove = (remitWeight / totalWeight) * totalGbpMwh;
  const residual = totalGbpMwh - windMove - gasMove - remitMove;

  return { wind: windMove, gas: gasMove, remit: remitMove, residual };
}

export function premiumWindGbpPosition(
  p: PositionRow,
  windMoveGbpMwh: number,
): number {
  if (isSpreadInstrument(p)) return 0;
  if (!isGbPowerMarket(p)) return 0;
  if ((p.unit ?? "").toLowerCase() !== "mw") return 0;
  const dm = dirMult(p.direction);
  const sz = Number(p.size);
  if (!Number.isFinite(sz)) return 0;
  return windMoveGbpMwh * sz * dm;
}

export function premiumRemitGbpPosition(
  p: PositionRow,
  remitMoveGbpMwh: number,
): number {
  return premiumWindGbpPosition(p, remitMoveGbpMwh);
}

/** Residual market move attribution on GB power legs (shape/basis/intraday effects). */
export function premiumShapeGbpPosition(
  p: PositionRow,
  shapeMoveGbpMwh: number,
): number {
  return premiumWindGbpPosition(p, shapeMoveGbpMwh);
}

export function premiumGasGbpPosition(
  p: PositionRow,
  gasMoveGbpMwh: number,
): number {
  if (isSpreadInstrument(p)) return 0;
  const m = (p.market ?? "").toLowerCase().replace(/\s/g, "_");
  const dm = dirMult(p.direction);
  const sz = Number(p.size);
  if (!Number.isFinite(sz)) return 0;
  if (m === "gb_power" && (p.unit ?? "").toLowerCase() === "mw") {
    return gasMoveGbpMwh * sz * dm;
  }
  if (m === "ttf" || m === "other_gas") {
    return gasMoveGbpMwh * sz * dm;
  }
  if (m === "nbp") {
    return gasMoveGbpMwh * (sz / 1000) * dm;
  }
  return 0;
}

export function computePremiumAttributionGbp(
  totalPriceMoveGbpMwh: number,
  physical: PhysicalPremiumInput,
  positions: PositionRow[],
): {
  windGbp: number;
  gasGbp: number;
  remitGbp: number;
  windMoveGbpMwh: number;
  gasMoveGbpMwh: number;
  remitMoveGbpMwh: number;
  priceResidualMoveGbpMwh: number;
} {
  const part = partitionPriceMoveGbpMwh(totalPriceMoveGbpMwh, physical);
  let windGbp = 0;
  let gasGbp = 0;
  let remitGbp = 0;
  for (const p of positions) {
    windGbp += premiumWindGbpPosition(p, part.wind);
    gasGbp += premiumGasGbpPosition(p, part.gas);
    remitGbp += premiumRemitGbpPosition(p, part.remit);
  }
  return {
    windGbp,
    gasGbp,
    remitGbp,
    windMoveGbpMwh: part.wind,
    gasMoveGbpMwh: part.gas,
    remitMoveGbpMwh: part.remit,
    priceResidualMoveGbpMwh: part.residual,
  };
}
