import {
  eurMwhPnlToGbp,
  GBP_PER_EUR,
  linearPnl,
  MWH_TO_THERM,
  netDeltaMw,
  nbpPnlGbp,
  PositionRow,
  type LivePrices,
} from "@/lib/portfolio/book";

/** £/MWh per GW of wind change (attribution model). */
export const WIND_SENS_GBP_PER_MWH_PER_GW = 2.5;
/** £/MWh per €/MWh TTF move (EUR → GBP at 0.86). */
export const GAS_TTF_GBP_PER_EUR_MWH = GBP_PER_EUR;
/** £/MWh per 100 MW REMIT delta. */
export const REMIT_SENS_GBP_PER_100MW = 0.5;

/**
 * NBP p/th from TTF (EUR/MWh) — attribution page convention (spec: ×100).
 * Differs from Book’s `ttfToNbpPencePerTherm` (×10) intentionally for this view.
 */
export function attributionTtfToNbpPencePerTherm(ttfEurMwh: number): number {
  return (ttfEurMwh * GBP_PER_EUR * 100) / MWH_TO_THERM;
}

export function dirMult(direction: string | null): number {
  const d = (direction ?? "").toLowerCase();
  if (d === "long") return 1;
  if (d === "short") return -1;
  return 0;
}

export function isGbPowerMarket(p: PositionRow): boolean {
  const m = (p.market ?? "").toLowerCase().replace(/\s/g, "_");
  return m === "gb_power" || m === "gbpower";
}

export function isGasMarket(p: PositionRow): boolean {
  const m = (p.market ?? "").toLowerCase().replace(/\s/g, "_");
  return m === "ttf" || m === "nbp" || m === "other_gas";
}

/** Same “Today P&amp;L” as Book table: open → current intraday. */
export function positionTodayPnlGbp(
  p: PositionRow,
  lp: LivePrices | null,
): number | null {
  if (!lp) return null;
  const mlow = (p.market ?? "").toLowerCase().replace(/\s/g, "_");
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
    return eurMwhPnlToGbp(p.direction, opE, curE, p.size);
  }
  const cur = mlow === "gb_power" ? lp.gbPowerGbpMwh : null;
  const opn = mlow === "gb_power" ? lp.gbPowerOpenGbpMwh : null;
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

export function windPriceImpactGbpPerMwh(deltaWindGw: number): number {
  return deltaWindGw * WIND_SENS_GBP_PER_MWH_PER_GW;
}

export function windAttributionForPosition(
  deltaWindGw: number,
  p: PositionRow,
): number {
  if (!isGbPowerMarket(p)) return 0;
  const dm = dirMult(p.direction);
  if (dm === 0) return 0;
  const sz = Number(p.size);
  if (!Number.isFinite(sz)) return 0;
  return windPriceImpactGbpPerMwh(deltaWindGw) * sz * dm;
}

export function remitPriceImpactGbpPerMwh(deltaRemitMw: number): number {
  return (deltaRemitMw / 100) * REMIT_SENS_GBP_PER_100MW;
}

export function remitAttributionForPosition(
  deltaRemitMw: number,
  p: PositionRow,
): number {
  if (!isGbPowerMarket(p)) return 0;
  const pip = remitPriceImpactGbpPerMwh(deltaRemitMw);
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
): number {
  if (!isGasMarket(p)) return 0;
  const dm = dirMult(p.direction);
  if (dm === 0) return 0;
  const sz = Number(p.size);
  if (!Number.isFinite(sz)) return 0;
  const m = (p.market ?? "").toLowerCase().replace(/\s/g, "_");
  const deltaTtf = ttfCurrent - ttfStart;
  if (m === "ttf" || m === "other_gas") {
    return deltaTtf * GAS_TTF_GBP_PER_EUR_MWH * sz * dm;
  }
  if (m === "nbp") {
    const pStart = attributionTtfToNbpPencePerTherm(ttfStart);
    const pEnd = attributionTtfToNbpPencePerTherm(ttfCurrent);
    return nbpPnlGbp(p.direction, pStart, pEnd, sz) ?? 0;
  }
  return 0;
}

export function sumWindAttribution(
  positions: PositionRow[],
  deltaWindGw: number,
): number {
  let s = 0;
  for (const p of positions) {
    s += windAttributionForPosition(deltaWindGw, p);
  }
  return s;
}

export function sumGasAttribution(
  positions: PositionRow[],
  ttfStart: number | null,
  ttfCurrent: number | null,
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
    s += gasAttributionForPosition(ttfStart, ttfCurrent, p);
  }
  return s;
}

export function sumRemitAttribution(
  positions: PositionRow[],
  deltaRemitMw: number,
): number {
  let s = 0;
  for (const p of positions) {
    s += remitAttributionForPosition(deltaRemitMw, p);
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
  const w = Math.max(0, Number(p.wind_gw) || 0);
  const s = Math.max(0, Number(p.solar_gw) || 0);
  const r = Math.max(0, Number(p.residual_demand_gw) || 0);
  const denom = w + s + r;
  const windShare = denom > EPS ? w / denom : 0;

  const mkt = Number(p.market_price_gbp_mwh);
  const srmc = Number(p.srmc_gbp_mwh);
  let gasShare =
    mkt > EPS && Number.isFinite(srmc) && Number.isFinite(mkt)
      ? srmc / mkt
      : 0;
  gasShare = Math.min(1, Math.max(0, gasShare));

  const remitMw = Math.max(0, Number(p.remit_mw_lost) || 0);
  let remitShare = remitMw / 5000;
  remitShare = Math.min(1, Math.max(0, remitShare));

  const windMove = windShare * totalGbpMwh;
  const gasMove = gasShare * totalGbpMwh;
  const remitMove = remitShare * totalGbpMwh;
  const residual = totalGbpMwh - windMove - gasMove - remitMove;
  return { wind: windMove, gas: gasMove, remit: remitMove, residual };
}

export function premiumWindGbpPosition(
  p: PositionRow,
  windMoveGbpMwh: number,
): number {
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
