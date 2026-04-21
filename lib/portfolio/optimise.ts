import type { PositionRow } from "@/lib/portfolio/book";
import { PORTFOLIO_STRESS_SCENARIOS } from "@/lib/portfolio/stress-scenarios-data";

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

function directionMult(direction: string | null): number {
  return (direction ?? "").toLowerCase() === "short" ? -1 : 1;
}

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

function pnlForPosition(position: PositionRow, scenario: Scenario, gbpPerEur: number): number {
  const m = marketKey(position.market);
  const size = Number(position.size ?? 0);
  if (!Number.isFinite(size) || size === 0) return 0;
  const dm = directionMult(position.direction);
  if (m === "GB_POWER") return scenario.gbPowerMove * size * dm;
  const fx = Number.isFinite(scenario.gbpPerEur) ? (scenario.gbpPerEur as number) : gbpPerEur;
  if (m === "TTF") return scenario.ttfMoveEurMwh * fx * size * dm;
  if (m === "NBP") return (scenario.nbpMovePth * size * dm) / 100;
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
  const idx = Math.floor(confidence * sortedLossesAsc.length);
  const bounded = Math.min(sortedLossesAsc.length - 1, Math.max(0, idx));
  return sortedLossesAsc[bounded];
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
  const stabilityPass = stabilityIndex <= 0.12;

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
