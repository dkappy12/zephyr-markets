import {
  positionDirectionSign,
  tenorToExpiryDate,
  type PositionRow,
} from "@/lib/portfolio/book";
import { PORTFOLIO_STRESS_SCENARIOS } from "@/lib/portfolio/stress-scenarios-data";

/**
 * Abramowitz & Stegun §26.2.17 — polynomial approximation to Φ(x), the
 * standard normal cumulative distribution function.
 */
function standardNormalCdf(x: number): number {
  const a1 = 0.31938153;
  const a2 = -0.356563782;
  const a3 = 1.781477937;
  const a4 = -1.821255978;
  const a5 = 1.330274429;
  const p = 0.2316419;

  const ax = Math.abs(x);
  const t = 1 / (1 + p * ax);
  const poly =
    t * (a1 + t * (a2 + t * (a3 + t * (a4 + a5 * t))));
  const pdf = Math.exp(-0.5 * ax * ax) / Math.sqrt(2 * Math.PI);
  const tail = pdf * poly;
  const cdfPos = 1 - tail;
  return x >= 0 ? cdfPos : 1 - cdfPos;
}

/**
 * Black-76 delta on the forward for a European option on F.
 * d₁ = (ln(F/K) + ½σ²T) / (σ√T); call delta = N(d₁), put delta = N(d₁) − 1.
 */
export function black76Delta(
  F: number,
  K: number,
  T: number,
  sigma: number,
  optionType: "call" | "put",
): number {
  if (
    !Number.isFinite(F) ||
    !Number.isFinite(K) ||
    F <= 0 ||
    K <= 0 ||
    !Number.isFinite(sigma) ||
    sigma <= 0
  ) {
    return optionType === "call" ? 0 : -1;
  }
  const epsT = 1e-12;
  const Te = !Number.isFinite(T) || T <= 0 ? epsT : T;
  const sqrtT = Math.sqrt(Te);
  const denom = sigma * sqrtT;
  if (denom <= 0) return optionType === "call" ? 0 : -1;
  const d1 =
    (Math.log(F / K) + 0.5 * sigma * sigma * Te) / denom;
  const nd1 = standardNormalCdf(d1);
  return optionType === "call" ? nd1 : nd1 - 1;
}

export type TenorBucket = {
  label: string;
  gbPowerMw: number;
  ttfMw: number;
  nbpMw: number;
  positionCount: number;
};

const TENOR_BUCKET_ORDER = [
  "Prompt",
  "Front Quarter",
  "Back Year",
  "Cal+2",
] as const;

/**
 * Net signed exposure (MW for GB power and TTF; therms for NBP) by tenor
 * bucket vs a reference date. Tenor is resolved via {@link tenorToExpiryDate};
 * null or same-calendar-day-as-reference (spot/prompt) maps to Prompt.
 */
export function tenorBucketedExposure(
  positions: PositionRow[],
  referenceDate: Date = new Date(),
): TenorBucket[] {
  const directionMult = positionDirectionSign;

  function exposureMarketKey(
    market: string | null,
  ): "GB_POWER" | "TTF" | "NBP" | "OTHER" {
    const m = (market ?? "").toUpperCase().replace(/\s+/g, "_");
    if (m.includes("GB_POWER")) return "GB_POWER";
    if (m === "TTF") return "TTF";
    if (m === "NBP") return "NBP";
    return "OTHER";
  }

  const refDayStr = referenceDate.toISOString().slice(0, 10);

  function monthsAfterReference(expiryYmd: string): number {
    const [y, mo, d] = expiryYmd.split("-").map(Number);
    if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return 0;
    const refMs = Date.UTC(
      referenceDate.getUTCFullYear(),
      referenceDate.getUTCMonth(),
      referenceDate.getUTCDate(),
    );
    const expMs = Date.UTC(y, mo - 1, d);
    return (expMs - refMs) / (86400000 * 30.4375);
  }

  function bucketLabelForExpiry(
    expiryYmd: string | null,
  ): (typeof TENOR_BUCKET_ORDER)[number] {
    if (expiryYmd == null || expiryYmd === refDayStr) return "Prompt";
    const months = monthsAfterReference(expiryYmd);
    if (months < 1) return "Prompt";
    if (months < 3) return "Front Quarter";
    if (months < 12) return "Back Year";
    return "Cal+2";
  }

  const accum = new Map<
    (typeof TENOR_BUCKET_ORDER)[number],
    { gb: number; ttf: number; nbp: number; n: number }
  >();
  for (const label of TENOR_BUCKET_ORDER) {
    accum.set(label, { gb: 0, ttf: 0, nbp: 0, n: 0 });
  }

  for (const p of positions) {
    const expiryYmd = tenorToExpiryDate(p.tenor, referenceDate);
    const label = bucketLabelForExpiry(expiryYmd);
    const row = accum.get(label)!;
    row.n += 1;

    const key = exposureMarketKey(p.market);
    const size = Number(p.size ?? 0);
    if (!Number.isFinite(size) || size === 0) continue;
    const dm = directionMult(p.direction);
    if (key === "GB_POWER") row.gb += size * dm;
    else if (key === "TTF") row.ttf += size * dm;
    else if (key === "NBP") row.nbp += size * dm;
  }

  return TENOR_BUCKET_ORDER.map((label) => {
    const a = accum.get(label)!;
    return {
      label,
      gbPowerMw: a.gb,
      ttfMw: a.ttf,
      nbpMw: a.nbp,
      positionCount: a.n,
    };
  });
}

/** Top-package objective spread / mean; pass when at or below this (lower = stabler). */
export const STABILITY_INDEX_PASS_MAX = 0.12;
/** Theoretical max spread when means differ wildly (display scale). */
export const STABILITY_INDEX_SCALE_MAX = 1.0;

export type OptimiseObjective = "cvar" | "var";

export type Scenario = {
  id: string;
  label: string;
  source: "historical" | "stress";
  gbPowerMove: number;
  ttfMoveEurMwh: number;
  nbpMovePth: number;
  gbpPerEur?: number;
};

export type HedgeTrade = {
  market: "GB_POWER" | "TTF" | "NBP";
  direction: "BUY" | "SELL";
  size: number;
  unit: "MW" | "therm";
};

export type RiskMetrics = {
  varLoss: number;
  cvarLoss: number;
  worstStressLoss: number;
};

export type Recommendation = {
  instrument: HedgeTrade["market"];
  direction: HedgeTrade["direction"];
  size: number;
  unit: HedgeTrade["unit"];
  rationale: string;
  impact: {
    var95Reduction: number;
    cvar95Reduction: number;
    worstStressReduction: number;
  };
  constraintsApplied: string[];
  confidence: "High" | "Medium" | "Low";
  scenarioBreakdown: Array<{
    scenarioLabel: string;
    pnlBefore: number;
    pnlAfter: number;
    improvement: number;
  }>;
};

export type OptimiseResult = {
  before: RiskMetrics;
  after: RiskMetrics;
  deltas: {
    var95Reduction: number;
    cvar95Reduction: number;
    worstStressReduction: number;
  };
  recommendations: Recommendation[];
  alternatives: Array<{
    rank: number;
    trades: HedgeTrade[];
    after: RiskMetrics;
    deltas: {
      var95Reduction: number;
      cvar95Reduction: number;
      worstStressReduction: number;
    };
  }>;
  diagnostics: {
    scenarioCount: number;
    historicalScenarioCount: number;
    stressScenarioCount: number;
    fallbackUsed: boolean;
    /**
     * True when we have enough **historical** (non-fallback) scenarios to
     * estimate the requested tail quantile. If false, VaR/CVaR from
     * `computeRiskMetrics` are not meaningfully distinct across confidence
     * levels and the UI should show an em dash instead of a number.
     */
    historicalTailReliable: boolean;
    candidatePackageCount: number;
    nbpProxyUsed: boolean;
    stabilityIndex: number;
    stabilityPass: boolean;
    noAction: boolean;
    noActionReason: string | null;
    guardrailFilteredCount: number;
  };
};

const STRESS_SCENARIOS: Scenario[] = PORTFOLIO_STRESS_SCENARIOS.map((s) => ({
  id: s.id,
  label: s.label,
  source: "stress" as const,
  gbPowerMove: s.gbPowerMove,
  ttfMoveEurMwh: s.ttfMoveEurMwh,
  nbpMovePth: s.nbpMovePth,
}));

/**
 * Safety caps for historical-scenario move synthesis. These are the last
 * line of defense after {@link aggregateDailyGasPrices} has already
 * rejected implausible absolute price levels — a move this large between
 * two otherwise-accepted days almost always means the feed flipped
 * between a bad tick and a good tick rather than a real market event.
 *
 * Tightened in the 2026-04 post-audit fixes after we saw a ~45 p/th
 * fake NBP move slip past the previous 80 p/th cap and manufacture a
 * multi-thousand-pound fake VaR tail in a real user's book.
 */
const HISTORICAL_MOVE_CAPS = {
  gbPowerMove: 250,
  ttfMoveEurMwh: 25,
  nbpMovePth: 30,
} as const;

const directionMult = positionDirectionSign;

function hasMaterialPositions(positions: PositionRow[]): boolean {
  return positions.some((p) => {
    const s = Number(p.size ?? 0);
    return Number.isFinite(s) && s !== 0;
  });
}

function marketKey(market: string | null): "GB_POWER" | "TTF" | "NBP" | "OTHER" {
  const m = (market ?? "").toUpperCase().replace(/\s+/g, "_");
  if (m.includes("GB_POWER")) return "GB_POWER";
  if (m === "TTF") return "TTF";
  if (m === "NBP") return "NBP";
  return "OTHER";
}

function unitForMarket(market: HedgeTrade["market"]): HedgeTrade["unit"] {
  return market === "NBP" ? "therm" : "MW";
}

function lotStepForMarket(market: HedgeTrade["market"]): number {
  if (market === "TTF") return 5;
  if (market === "NBP") return 1000;
  return 1;
}

function maxSizeForMarket(market: HedgeTrade["market"], netAbs: number): number {
  const hardCap = market === "NBP" ? 5_000_000 : market === "TTF" ? 1_500 : 5_000;
  const softCap = Math.max(netAbs * 1.5, lotStepForMarket(market));
  return Math.min(hardCap, softCap);
}

function roundToStep(value: number, step: number): number {
  if (!Number.isFinite(value) || value === 0) return 0;
  return Math.round(value / step) * step;
}

/** Replace with live forwards from the same market-data fetch as scenario moves. */
const OPTION_PLACEHOLDER_FORWARD_GBP_POWER = 95.0;
const OPTION_PLACEHOLDER_FORWARD_TTF_EUR_MWH = 35.0;
const OPTION_PLACEHOLDER_FORWARD_NBP_PTH = 85.0;

/**
 * Placeholder implied volatilities (decimal annualised) pending a live vol surface.
 * GB Power options use 0.35; TTF and NBP options use 0.40.
 */
const OPTION_IV_GB_POWER = 0.35;
const OPTION_IV_TTF_NBP = 0.4;

export type OptionBookNoticeRow = {
  instrumentLabel: string;
  delta: number;
  effectiveNotional: number;
  unitShort: string;
};

function instrumentTypeLooksLikeOption(instrumentType: string | null): boolean {
  const s = (instrumentType ?? "").toLowerCase();
  return s.includes("option") || s.includes("call") || s.includes("put");
}

function optionSideFromPosition(position: PositionRow): "call" | "put" {
  const blob = `${position.instrument ?? ""} ${position.instrument_type ?? ""}`.toLowerCase();
  if (blob.includes("put")) return "put";
  if (blob.includes("call")) return "call";
  return "call";
}

function placeholderForwardForOptimiseOption(m: "GB_POWER" | "TTF" | "NBP"): number {
  if (m === "GB_POWER") return OPTION_PLACEHOLDER_FORWARD_GBP_POWER;
  if (m === "TTF") return OPTION_PLACEHOLDER_FORWARD_TTF_EUR_MWH;
  return OPTION_PLACEHOLDER_FORWARD_NBP_PTH;
}

function placeholderIvForOptimiseOption(m: "GB_POWER" | "TTF" | "NBP"): number {
  return m === "GB_POWER" ? OPTION_IV_GB_POWER : OPTION_IV_TTF_NBP;
}

function strikeFromTradePriceOrAtm(position: PositionRow, forward: number): number {
  const k = Number(position.trade_price ?? NaN);
  if (Number.isFinite(k) && k > 0) return k;
  return forward;
}

function yearsToExpiryYearsForOption(
  position: PositionRow,
  referenceDate: Date = new Date(),
): number {
  let ymd: string | null = null;
  const ed = position.expiry_date?.trim();
  if (ed && /^\d{4}-\d{2}-\d{2}/.test(ed)) {
    ymd = ed.slice(0, 10);
  } else {
    ymd = tenorToExpiryDate(position.tenor, referenceDate);
  }
  if (!ymd) return 0.25;
  const y = Number(ymd.slice(0, 4));
  const mo = Number(ymd.slice(5, 7));
  const d = Number(ymd.slice(8, 10));
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return 0.25;
  const expMs = Date.UTC(y, mo - 1, d);
  const nowMs = Date.UTC(
    referenceDate.getUTCFullYear(),
    referenceDate.getUTCMonth(),
    referenceDate.getUTCDate(),
  );
  const years = (expMs - nowMs) / (86400000 * 365.25);
  return Math.max(1e-8, years);
}

/**
 * Signed linear exposure used in scenario P&L: for plain positions `size × dm`;
 * for options `delta × size × dm` (delta from {@link black76Delta}).
 */
function linearExposureForScenarioPnl(position: PositionRow): number {
  const m = marketKey(position.market);
  const size = Number(position.size ?? 0);
  if (!Number.isFinite(size) || size === 0 || m === "OTHER") return 0;
  const dm = directionMult(position.direction);
  if (!instrumentTypeLooksLikeOption(position.instrument_type)) {
    return size * dm;
  }
  const F = placeholderForwardForOptimiseOption(m);
  const K = strikeFromTradePriceOrAtm(position, F);
  const T = yearsToExpiryYearsForOption(position);
  const sigma = placeholderIvForOptimiseOption(m);
  const side = optionSideFromPosition(position);
  const delta = black76Delta(F, K, T, sigma, side);
  return delta * size * dm;
}

/** Rows for UI: open option positions and their delta‑scaled notionals used by the optimiser. */
export function optionBookNoticeRowsOptimise(
  positions: PositionRow[],
): OptionBookNoticeRow[] {
  const rows: OptionBookNoticeRow[] = [];
  for (const p of positions) {
    if (!instrumentTypeLooksLikeOption(p.instrument_type)) continue;
    const m = marketKey(p.market);
    if (m === "OTHER") continue;
    const size = Number(p.size ?? 0);
    if (!Number.isFinite(size) || size === 0) continue;
    const F = placeholderForwardForOptimiseOption(m);
    const K = strikeFromTradePriceOrAtm(p, F);
    const T = yearsToExpiryYearsForOption(p);
    const sigma = placeholderIvForOptimiseOption(m);
    const side = optionSideFromPosition(p);
    const delta = black76Delta(F, K, T, sigma, side);
    const dm = directionMult(p.direction);
    const effectiveNotional = delta * size * dm;
    const unitShort = m === "NBP" ? "therms" : "MW";
    const instrumentLabel =
      [p.instrument?.trim(), p.market?.trim()].filter(Boolean).join(" · ") ||
      "Option";
    rows.push({ instrumentLabel, delta, effectiveNotional, unitShort });
  }
  return rows;
}

function pnlForPosition(position: PositionRow, scenario: Scenario, gbpPerEur: number): number {
  const m = marketKey(position.market);
  const eff = linearExposureForScenarioPnl(position);
  if (!Number.isFinite(eff) || eff === 0) return 0;
  if (m === "GB_POWER") return scenario.gbPowerMove * eff;
  const fx = Number.isFinite(scenario.gbpPerEur) ? (scenario.gbpPerEur as number) : gbpPerEur;
  if (m === "TTF") return scenario.ttfMoveEurMwh * fx * eff;
  if (m === "NBP") return (scenario.nbpMovePth * eff) / 100;
  return 0;
}

function portfolioPnlForScenario(
  positions: PositionRow[],
  scenario: Scenario,
  gbpPerEur: number,
): number {
  return positions.reduce((sum, p) => sum + pnlForPosition(p, scenario, gbpPerEur), 0);
}

function asSyntheticPosition(trade: HedgeTrade): PositionRow {
  return {
    id: `synthetic-${trade.market}-${trade.direction}-${trade.size}`,
    user_id: "synthetic",
    created_at: new Date(0).toISOString(),
    direction: trade.direction === "BUY" ? "long" : "short",
    expiry_date: null,
    instrument: trade.market,
    instrument_type: "other_energy",
    is_hypothetical: true,
    market:
      trade.market === "GB_POWER"
        ? "GB_power"
        : trade.market === "TTF"
          ? "TTF"
          : "NBP",
    size: trade.size,
    tenor: "prompt",
    trade_price: null,
    unit: trade.unit,
    currency: trade.market === "TTF" ? "EUR" : "GBP",
    source: "optimiser",
    notes: null,
    is_closed: false,
    close_price: null,
    close_date: null,
    entry_date: null,
    raw_csv_row: null,
  };
}

function quantileLoss(sortedLossesAsc: number[], confidence: number): number {
  if (sortedLossesAsc.length === 0) return 0;
  // `loss` is −(scenario P&L), sorted ascending: worst drawdowns sit at the
  // *high* end, so the (1−α) tail is indexed from the top — same as the
  // pre-2024 implementation (`floor(confidence * n)`), not the P&L-based
  // `floor((1−confidence)*n)` in `risk/page.tsx` which works on sign-flipped
  // P&L directly.
  const idx = Math.floor(confidence * sortedLossesAsc.length);
  const bounded = Math.min(sortedLossesAsc.length - 1, Math.max(0, idx));
  return sortedLossesAsc[bounded];
}

/**
 * How many i.i.d. historical loss draws we need to pin the (1−α) tail, same
 * rule of thumb as {@link app/dashboard/portfolio/risk} “Need 100+ days” for
 * 99% 1-day VaR (with α = 1−confidence in loss space, aligned to `quantileLoss`).
 */
export function minHistoricalScenariosForConfidence(confidence: number): number {
  const c = Math.min(0.999, Math.max(0.5, confidence));
  return Math.max(1, Math.ceil(1 / (1 - c)));
}

function computeRiskMetrics(
  positions: PositionRow[],
  empiricalScenarios: Scenario[],
  stressScenariosInput: Scenario[],
  gbpPerEur: number,
  confidence: number,
): RiskMetrics {
  const losses = empiricalScenarios.map(
    (s) => -positions.reduce((sum, p) => sum + pnlForPosition(p, s, gbpPerEur), 0),
  );
  const sorted = [...losses].sort((a, b) => a - b);
  const varLoss = quantileLoss(sorted, confidence);
  const tail = losses.filter((l) => l >= varLoss);
  const cvarLoss = tail.length > 0 ? tail.reduce((s, v) => s + v, 0) / tail.length : varLoss;
  const stressLosses = stressScenariosInput.map(
    (s) => -positions.reduce((sum, p) => sum + pnlForPosition(p, s, gbpPerEur), 0),
  );
  const worstStressLoss =
    stressLosses.length > 0 ? Math.max(...stressLosses) : varLoss;
  return { varLoss, cvarLoss, worstStressLoss };
}

function positionNetExposure(positions: PositionRow[], market: HedgeTrade["market"]): number {
  const target = market;
  return positions.reduce((sum, p) => {
    const k = marketKey(p.market);
    if (k !== target) return sum;
    const size = Number(p.size ?? 0);
    if (!Number.isFinite(size)) return sum;
    return sum + size * directionMult(p.direction);
  }, 0);
}

function candidateSizes(baseAbs: number, step: number, maxAbs: number): number[] {
  const anchors = [0.25, 0.5, 0.75, 1.0];
  const out = new Set<number>();
  for (const a of anchors) {
    const raw = Math.min(maxAbs, baseAbs * a);
    const rounded = Math.abs(roundToStep(raw, step));
    if (rounded > 0 && rounded <= maxAbs) out.add(rounded);
  }
  if (out.size === 0 && step <= maxAbs) out.add(step);
  return [...out];
}

function generateTradeOptions(positions: PositionRow[]): Record<HedgeTrade["market"], HedgeTrade[]> {
  const markets: HedgeTrade["market"][] = ["GB_POWER", "TTF", "NBP"];
  const options = {
    GB_POWER: [] as HedgeTrade[],
    TTF: [] as HedgeTrade[],
    NBP: [] as HedgeTrade[],
  };

  for (const market of markets) {
    const net = positionNetExposure(positions, market);
    const step = lotStepForMarket(market);
    const netAbs = Math.abs(net);
    const maxAbs = maxSizeForMarket(market, netAbs);
    const baseAbs = Math.max(netAbs, step);
    const sizes = candidateSizes(baseAbs, step, maxAbs);
    const opposite = net >= 0 ? "SELL" : "BUY";
    const same = opposite === "BUY" ? "SELL" : "BUY";
    options[market].push({
      market,
      direction: opposite,
      size: 0,
      unit: unitForMarket(market),
    });
    for (const s of sizes) {
      options[market].push({
        market,
        direction: opposite,
        size: s,
        unit: unitForMarket(market),
      });
      options[market].push({
        market,
        direction: same,
        size: s,
        unit: unitForMarket(market),
      });
    }
  }

  return options;
}

function cartesianCombos(options: Record<HedgeTrade["market"], HedgeTrade[]>): HedgeTrade[][] {
  const out: HedgeTrade[][] = [];
  for (const gb of options.GB_POWER) {
    for (const ttf of options.TTF) {
      for (const nbp of options.NBP) {
        const trades = [gb, ttf, nbp].filter((t) => t.size > 0);
        out.push(trades);
      }
    }
  }
  return out;
}

function clamp(n: number, absCap: number): number {
  return Math.max(-absCap, Math.min(absCap, n));
}

/**
 * Reference quote prices used to convert a hedge trade's `size` into a rough
 * monthly-delivery £ notional. These let us score trade cost on a like-for-like
 * basis across markets — previously the penalty formula was `size × bps × 1000`,
 * which gives GB_POWER (size in MW, typically ~50) a penalty of £20, while NBP
 * (size in therms, typically ~50,000) got £30,000 for an equivalent-notional
 * hedge. The result was NBP being systematically excluded from recommendations
 * even when it was the dominant tail-risk leg.
 */
const HEDGE_COST_REFERENCE_PRICE = {
  GB_POWER: 100, // £/MWh
  TTF: 35, // EUR/MWh (converted via gbpPerEur at call site)
  NBP: 100, // pence/therm (converted via /100 to £/therm at call site)
} as const;
const HEDGE_COST_BPS = {
  GB_POWER: 0.0004,
  TTF: 0.0004,
  NBP: 0.0006,
} as const;
const HOURS_PER_MONTH = 720;

function tradeCostPenalty(trades: HedgeTrade[], gbpPerEur: number): number {
  return trades.reduce((sum, t) => {
    const bps = HEDGE_COST_BPS[t.market];
    if (t.market === "GB_POWER") {
      // MW × £/MWh × h/month × bps
      return (
        sum +
        t.size * HEDGE_COST_REFERENCE_PRICE.GB_POWER * HOURS_PER_MONTH * bps
      );
    }
    if (t.market === "TTF") {
      return (
        sum +
        t.size *
          HEDGE_COST_REFERENCE_PRICE.TTF *
          gbpPerEur *
          HOURS_PER_MONTH *
          bps
      );
    }
    // NBP: size is therms (total), price is pence/therm → £/therm at /100.
    return sum + t.size * (HEDGE_COST_REFERENCE_PRICE.NBP / 100) * bps;
  }, 0);
}

function objectiveLoss(metrics: RiskMetrics, objective: OptimiseObjective): number {
  return objective === "cvar" ? metrics.cvarLoss : metrics.varLoss;
}

function relativeImprovement(before: number, after: number): number {
  const denom = Math.max(Math.abs(before), 1);
  return (before - after) / denom;
}

function confidenceLabel(scenarioCount: number, improvement: number): "High" | "Medium" | "Low" {
  if (scenarioCount >= 40 && improvement > 0.15) return "High";
  if (scenarioCount >= 20 && improvement > 0.05) return "Medium";
  return "Low";
}

function rationaleForTrade(trade: HedgeTrade, baseNet: number): string {
  const side = trade.direction === "BUY" ? "adds long" : "adds short";
  const counter = baseNet >= 0 ? "net long" : "net short";
  if (trade.market === "GB_POWER") {
    return `${side} GB power to offset ${counter} prompt power risk.`;
  }
  if (trade.market === "TTF") {
    return `${side} TTF to reduce gas-driven tail risk in cross-commodity scenarios.`;
  }
  return `${side} NBP to reduce p/th stress sensitivity in UK gas shocks.`;
}

export function optimisePortfolio(input: {
  positions: PositionRow[];
  scenarios: Scenario[];
  gbpPerEur: number;
  objective: OptimiseObjective;
  confidence: number;
  maxTrades: number;
  includeStress: boolean;
  nbpProxyUsed?: boolean;
}): OptimiseResult {
  const {
    positions,
    scenarios,
    gbpPerEur,
    objective,
    confidence,
    maxTrades,
    includeStress,
    nbpProxyUsed = false,
  } = input;

  const historicalScenarios = scenarios.filter((s) => s.source === "historical");
  const stressOnlyScenarios = includeStress
    ? scenarios.filter((s) => s.source === "stress")
    : [];
  const empiricalScenarios =
    historicalScenarios.length > 0 ? historicalScenarios : STRESS_SCENARIOS;
  const fallbackUsed = historicalScenarios.length === 0;
  const historicalTailReliable =
    !fallbackUsed &&
    historicalScenarios.length >=
      minHistoricalScenariosForConfidence(confidence);

  const before = computeRiskMetrics(
    positions,
    empiricalScenarios,
    stressOnlyScenarios,
    gbpPerEur,
    confidence,
  );

  if (!hasMaterialPositions(positions)) {
    return {
      before,
      after: before,
      deltas: {
        var95Reduction: 0,
        cvar95Reduction: 0,
        worstStressReduction: 0,
      },
      recommendations: [],
      alternatives: [],
      diagnostics: {
        scenarioCount: empiricalScenarios.length + stressOnlyScenarios.length,
        historicalScenarioCount: historicalScenarios.length,
        stressScenarioCount: stressOnlyScenarios.length,
        fallbackUsed,
        historicalTailReliable: false,
        candidatePackageCount: 0,
        nbpProxyUsed,
        stabilityIndex: 0,
        stabilityPass: true,
        noAction: true,
        noActionReason: "No open positions to hedge.",
        guardrailFilteredCount: 0,
      },
    };
  }

  const options = generateTradeOptions(positions);
  const combos = cartesianCombos(options).filter((c) => c.length <= maxTrades);

  const scored = combos.map((trades) => {
    const synthetic = trades.map(asSyntheticPosition);
    const combined = [...positions, ...synthetic];
    const after = computeRiskMetrics(
      combined,
      empiricalScenarios,
      stressOnlyScenarios,
      gbpPerEur,
      confidence,
    );
    const objectiveValue =
      objectiveLoss(after, objective) + tradeCostPenalty(trades, gbpPerEur);
    return { trades, after, objectiveValue };
  });

  // Allow a hedge package to worsen the worst-stress scenario by at most 8%
  // of the current worst-stress loss, with a £100 floor so small books are
  // not held hostage to tiny absolute moves. Previously 2% with a £1 floor,
  // which caused most candidate packages to be filtered on small books even
  // when they delivered large CVaR improvements for trivial stress worsening.
  const STRESS_GUARDRAIL_TOLERANCE = 0.08;
  const STRESS_GUARDRAIL_FLOOR_GBP = 100;
  const MIN_RELATIVE_IMPROVEMENT = 0.02;
  const beforeObjective = objectiveLoss(before, objective);
  const guardrailScored = scored.filter((row) => {
    const stressWorsening = row.after.worstStressLoss - before.worstStressLoss;
    if (stressWorsening <= 0) return true;
    const allowed = Math.max(
      STRESS_GUARDRAIL_FLOOR_GBP,
      before.worstStressLoss * STRESS_GUARDRAIL_TOLERANCE,
    );
    return stressWorsening <= allowed;
  });
  const guardrailFilteredCount = Math.max(0, scored.length - guardrailScored.length);
  const effectiveScored = guardrailScored.length > 0 ? guardrailScored : scored;

  effectiveScored.sort((a, b) => a.objectiveValue - b.objectiveValue);
  const best = effectiveScored[0] ?? {
    trades: [] as HedgeTrade[],
    after: before,
    objectiveValue: beforeObjective,
  };
  const bestRelImprovement = relativeImprovement(beforeObjective, objectiveLoss(best.after, objective));
  const noAction = best.trades.length === 0 || bestRelImprovement < MIN_RELATIVE_IMPROVEMENT;
  const selected = noAction
    ? {
        trades: [] as HedgeTrade[],
        after: before,
      }
    : best;

  const deltas = {
    var95Reduction: before.varLoss - selected.after.varLoss,
    cvar95Reduction: before.cvarLoss - selected.after.cvarLoss,
    worstStressReduction: before.worstStressLoss - selected.after.worstStressLoss,
  };

  const recommendations: Recommendation[] = selected.trades.map((trade) => {
    const withTrade = [...positions, asSyntheticPosition(trade)];
    const singleAfter = computeRiskMetrics(
      withTrade,
      empiricalScenarios,
      stressOnlyScenarios,
      gbpPerEur,
      confidence,
    );
    const scenarioUniverse = [...empiricalScenarios, ...stressOnlyScenarios];
    const scenarioBreakdown = scenarioUniverse
      .map((s) => {
        const pnlBefore = portfolioPnlForScenario(positions, s, gbpPerEur);
        const pnlAfter = portfolioPnlForScenario(withTrade, s, gbpPerEur);
        return {
          scenarioLabel: s.label,
          pnlBefore,
          pnlAfter,
          improvement: pnlAfter - pnlBefore,
          absLossBefore: Math.abs(-pnlBefore),
        };
      })
      .sort((a, b) => b.absLossBefore - a.absLossBefore)
      .slice(0, 5)
      .map((row) => ({
        scenarioLabel: row.scenarioLabel,
        pnlBefore: row.pnlBefore,
        pnlAfter: row.pnlAfter,
        improvement: row.improvement,
      }));
    const beforeObj = objectiveLoss(before, objective);
    const afterObj = objectiveLoss(singleAfter, objective);
    const singleImprovement =
      (beforeObj - afterObj) / Math.max(Math.abs(beforeObj), 1);
    return {
      instrument: trade.market,
      direction: trade.direction,
      size: trade.size,
      unit: trade.unit,
      rationale: rationaleForTrade(trade, positionNetExposure(positions, trade.market)),
      impact: {
        var95Reduction: before.varLoss - singleAfter.varLoss,
        cvar95Reduction: before.cvarLoss - singleAfter.cvarLoss,
        worstStressReduction: before.worstStressLoss - singleAfter.worstStressLoss,
      },
      constraintsApplied: [
        `lot step ${lotStepForMarket(trade.market)} ${trade.unit}`,
        `max ${maxTrades} trades`,
      ],
      confidence: confidenceLabel(empiricalScenarios.length, singleImprovement),
      scenarioBreakdown,
    };
  });

  const topRanks = effectiveScored.slice(0, 3);
  const objectiveValues = topRanks.map((row) => objectiveLoss(row.after, objective));
  const mean =
    objectiveValues.length > 0
      ? objectiveValues.reduce((s, v) => s + v, 0) / objectiveValues.length
      : 0;
  const variance =
    objectiveValues.length > 0
      ? objectiveValues.reduce((s, v) => s + (v - mean) ** 2, 0) / objectiveValues.length
      : 0;
  const stabilityIndex = mean > 0 ? Math.sqrt(variance) / mean : 0;
  /** Coefficient-of-variation style index; lower is more stable. */
  const stabilityPass = stabilityIndex <= STABILITY_INDEX_PASS_MAX;

  const alternatives = topRanks.map((row, idx) => ({
    rank: idx + 1,
    trades: row.trades,
    after: row.after,
    deltas: {
      var95Reduction: before.varLoss - row.after.varLoss,
      cvar95Reduction: before.cvarLoss - row.after.cvarLoss,
      worstStressReduction: before.worstStressLoss - row.after.worstStressLoss,
    },
  }));

  return {
    before,
    after: selected.after,
    deltas,
    recommendations,
    alternatives,
    diagnostics: {
      scenarioCount: empiricalScenarios.length + stressOnlyScenarios.length,
      historicalScenarioCount: historicalScenarios.length,
      stressScenarioCount: stressOnlyScenarios.length,
      fallbackUsed,
      historicalTailReliable,
      candidatePackageCount: combos.length,
      nbpProxyUsed,
      stabilityIndex,
      stabilityPass,
      noAction,
      noActionReason: noAction
        ? `Best package improves ${objective.toUpperCase()} by less than ${(MIN_RELATIVE_IMPROVEMENT * 100).toFixed(0)}%.`
        : null,
      guardrailFilteredCount,
    },
  };
}

/**
 * Standard CCGT-style heat rate: **MWh of (TTF-linked) gas burn per MWh of
 * power output**. Used to express the gas leg of a day-ahead spark move in
 * £/MWh alongside the GB power leg.
 */
const SPARK_HEAT_RATE_MWH_GAS_PER_MWH_POWER = 1.4;

export type SparkSpreadScenarioPoint = {
  label: string;
  spreadMove: number;
  bookPnl: number;
};

export type SparkSpreadExposureResult = {
  netPowerMw: number;
  netGasMw: number;
  heatRateAssumed: number;
  worstSparkScenarios: SparkSpreadScenarioPoint[];
  bestSparkScenarios: SparkSpreadScenarioPoint[];
  sparkVaR95: number;
};

function portfolioPowerAndGasLegPnl(
  positions: PositionRow[],
  scenario: Scenario,
  gbpPerEur: number,
): number {
  let sum = 0;
  for (const p of positions) {
    const k = marketKey(p.market);
    if (k === "GB_POWER" || k === "TTF" || k === "NBP") {
      sum += pnlForPosition(p, scenario, gbpPerEur);
    }
  }
  return sum;
}

/**
 * Spark spread diagnostics: historical spread moves vs power+gas leg P&L.
 * Same core inputs as {@link optimisePortfolio} (positions, scenarios,
 * gbpPerEur); uses only **historical** scenarios for spread moves and VaR.
 */
export function computeSparkSpreadExposure(input: {
  positions: PositionRow[];
  scenarios: Scenario[];
  gbpPerEur: number;
}): SparkSpreadExposureResult {
  const { positions, scenarios, gbpPerEur } = input;
  const netPowerMw = positionNetExposure(positions, "GB_POWER");
  const netGasMw = positionNetExposure(positions, "TTF");

  const historical = scenarios.filter((s) => s.source === "historical");

  const rows: SparkSpreadScenarioPoint[] = historical.map((s) => {
    const fx = Number.isFinite(s.gbpPerEur) ? (s.gbpPerEur as number) : gbpPerEur;
    // Spark move (£/MWh): power move minus gas cost wedge at assumed heat rate.
    const spreadMove =
      s.gbPowerMove - s.ttfMoveEurMwh * fx * SPARK_HEAT_RATE_MWH_GAS_PER_MWH_POWER;
    const bookPnl = portfolioPowerAndGasLegPnl(positions, s, gbpPerEur);
    return { label: s.label, spreadMove, bookPnl };
  });

  const byPnlAsc = [...rows].sort((a, b) => a.bookPnl - b.bookPnl);
  const worstSparkScenarios = byPnlAsc.slice(0, 5);
  const byPnlDesc = [...rows].sort((a, b) => b.bookPnl - a.bookPnl);
  const bestSparkScenarios = byPnlDesc.slice(0, 5);

  const losses = rows.map((r) => -r.bookPnl);
  const sortedLosses = [...losses].sort((a, b) => a - b);
  const sparkVaR95 =
    sortedLosses.length > 0 ? quantileLoss(sortedLosses, 0.95) : 0;

  return {
    netPowerMw,
    netGasMw,
    heatRateAssumed: SPARK_HEAT_RATE_MWH_GAS_PER_MWH_POWER,
    worstSparkScenarios,
    bestSparkScenarios,
    sparkVaR95,
  };
}

/** True when the book has material GB power and TTF or NBP gas exposure (spark panel gate). */
export function bookHasPowerAndGasForSpark(positions: PositionRow[]): boolean {
  let hasPower = false;
  let hasGas = false;
  for (const p of positions) {
    const s = Number(p.size ?? 0);
    if (!Number.isFinite(s) || s === 0) continue;
    const k = marketKey(p.market);
    if (k === "GB_POWER") hasPower = true;
    else if (k === "TTF" || k === "NBP") hasGas = true;
    if (hasPower && hasGas) return true;
  }
  return false;
}

export function stressScenarios(): Scenario[] {
  return STRESS_SCENARIOS;
}

export function buildHistoricalScenarios(input: {
  powerByDay: Record<string, number>;
  ttfByDayEur: Record<string, number>;
  nbpByDayPth: Record<string, number>;
  fxByDay?: Record<string, number>;
}): Scenario[] {
  // Union of all dates where any series has a print. Markets with a gap on
  // either side of a consecutive-date pair contribute a 0 move for that
  // scenario rather than dropping the whole date (which would zero the sample
  // set whenever one feed has a shorter history than the others — the bug
  // that left Optimise with `hist 0` scenarios pre-fix).
  const dateUniverse = new Set<string>([
    ...Object.keys(input.powerByDay),
    ...Object.keys(input.ttfByDayEur),
    ...Object.keys(input.nbpByDayPth),
  ]);
  const dates = Array.from(dateUniverse).sort();
  // Returns the clamped delta when both prev and curr prints are finite, or
  // null when either side is missing. Null signals "no data" so callers can
  // tell a genuine flat market (0) apart from a feed gap (skip).
  const diff = (
    byDay: Record<string, number>,
    prev: string,
    curr: string,
    cap: number,
  ): number | null => {
    const p = byDay[prev];
    const c = byDay[curr];
    if (p == null || c == null || !Number.isFinite(p) || !Number.isFinite(c)) {
      return null;
    }
    return clamp(c - p, cap);
  };
  const rows: Scenario[] = [];
  for (let i = 1; i < dates.length; i++) {
    const prev = dates[i - 1];
    const curr = dates[i];
    const gbPowerDelta = diff(
      input.powerByDay,
      prev,
      curr,
      HISTORICAL_MOVE_CAPS.gbPowerMove,
    );
    const ttfDelta = diff(
      input.ttfByDayEur,
      prev,
      curr,
      HISTORICAL_MOVE_CAPS.ttfMoveEurMwh,
    );
    const nbpDelta = diff(
      input.nbpByDayPth,
      prev,
      curr,
      HISTORICAL_MOVE_CAPS.nbpMovePth,
    );
    if (gbPowerDelta == null && ttfDelta == null && nbpDelta == null) {
      // No market had both prev and curr prints; skip rather than emit a
      // sample the callers can't distinguish from a flat day.
      continue;
    }
    rows.push({
      id: `hist-${curr}`,
      label: curr,
      source: "historical",
      gbPowerMove: gbPowerDelta ?? 0,
      ttfMoveEurMwh: ttfDelta ?? 0,
      nbpMovePth: nbpDelta ?? 0,
      gbpPerEur: input.fxByDay?.[curr],
    });
  }
  return rows;
}

/**
 * NBP rows in `gas_prices` are stored in pence/therm despite the column being
 * named `price_eur_mwh` (Stooq NF.F is natively p/th). Pass through unchanged
 * so `nbpMovePth` day-over-day deltas match the same unit used by stress
 * scenarios. Fx map is unused but kept in the signature for call-site parity
 * in case the underlying feed ever switches to a truly EUR/MWh-denominated
 * source and needs conversion via `ttfToNbpPencePerTherm` from `book.ts`.
 */
export function nbpLevelsPthByDay(
  nbpByDayPth: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [day, pth] of Object.entries(nbpByDayPth)) {
    if (Number.isFinite(pth)) out[day] = pth;
  }
  return out;
}
