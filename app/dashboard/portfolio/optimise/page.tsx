"use client";

import type { HedgeTrade } from "@/lib/portfolio/optimise";
import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";

type ApiResponse = {
  generatedAt: string;
  objective: "cvar" | "var";
  confidence: number;
  maxTrades: number;
  includeStress: boolean;
  gbpPerEur: number;
  before: { varLoss: number; cvarLoss: number; worstStressLoss: number };
  after: { varLoss: number; cvarLoss: number; worstStressLoss: number };
  deltas: {
    var95Reduction: number;
    cvar95Reduction: number;
    worstStressReduction: number;
  };
  recommendations: Array<{
    instrument: "GB_POWER" | "TTF" | "NBP";
    direction: "BUY" | "SELL";
    size: number;
    unit: "MW" | "therm";
    rationale: string;
    impact: {
      var95Reduction: number;
      cvar95Reduction: number;
      worstStressReduction: number;
    };
    constraintsApplied: string[];
    confidence: "High" | "Medium" | "Low";
  }>;
  alternatives: Array<{
    rank: number;
    trades: HedgeTrade[];
    after: { varLoss: number; cvarLoss: number; worstStressLoss: number };
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
  };
};

function formatGbp(n: number): string {
  const sign = n >= 0 ? "" : "−";
  return `${sign}£${Math.abs(n).toLocaleString("en-GB", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

export default function OptimisePage() {
  const [objective, setObjective] = useState<"cvar" | "var">("cvar");
  const [confidence, setConfidence] = useState(0.95);
  const [maxTrades, setMaxTrades] = useState(3);
  const [includeStress, setIncludeStress] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ApiResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          objective,
          confidence: String(confidence),
          maxTrades: String(maxTrades),
          includeStress: String(includeStress),
        });
        const res = await fetch(`/api/optimise/recommendations?${params.toString()}`);
        const body = (await res.json()) as ApiResponse | { error?: string };
        if (!res.ok) {
          throw new Error("error" in body ? body.error : "Optimiser request failed");
        }
        if (!cancelled) setData(body as ApiResponse);
      } catch (e: unknown) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load recommendations");
          setData(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [objective, confidence, maxTrades, includeStress]);

  const cards = useMemo(() => {
    if (!data) return [];
    return [
      {
        label: "VaR 95",
        before: data.before.varLoss,
        after: data.after.varLoss,
        delta: data.deltas.var95Reduction,
      },
      {
        label: "CVaR 95",
        before: data.before.cvarLoss,
        after: data.after.cvarLoss,
        delta: data.deltas.cvar95Reduction,
      },
      {
        label: "Worst Stress",
        before: data.before.worstStressLoss,
        after: data.after.worstStressLoss,
        delta: data.deltas.worstStressReduction,
      },
    ];
  }, [data]);

  return (
    <div className="space-y-8">
      <div>
        <motion.h1
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="font-serif text-3xl text-ink"
        >
          Optimise
        </motion.h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-mid">
          Scenario-based hedge recommendations with explicit before/after risk
          impact and executable lot constraints.
        </p>
      </div>

      <section className="grid gap-3 rounded-[4px] border-[0.5px] border-ivory-border bg-card p-4 md:grid-cols-4">
        <label className="text-xs text-ink-mid">
          Objective
          <select
            value={objective}
            onChange={(e) => setObjective(e.target.value as "cvar" | "var")}
            className="mt-1 w-full rounded border border-ivory-border bg-paper px-2 py-1 text-sm text-ink"
          >
            <option value="cvar">Minimise CVaR 95</option>
            <option value="var">Minimise VaR 95</option>
          </select>
        </label>
        <label className="text-xs text-ink-mid">
          Confidence
          <select
            value={confidence}
            onChange={(e) => setConfidence(Number(e.target.value))}
            className="mt-1 w-full rounded border border-ivory-border bg-paper px-2 py-1 text-sm text-ink"
          >
            <option value={0.95}>95%</option>
            <option value={0.99}>99%</option>
          </select>
        </label>
        <label className="text-xs text-ink-mid">
          Max Trades
          <select
            value={maxTrades}
            onChange={(e) => setMaxTrades(Number(e.target.value))}
            className="mt-1 w-full rounded border border-ivory-border bg-paper px-2 py-1 text-sm text-ink"
          >
            <option value={1}>1</option>
            <option value={2}>2</option>
            <option value={3}>3</option>
            <option value={4}>4</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={includeStress}
            onChange={(e) => setIncludeStress(e.target.checked)}
          />
          Include stress scenarios
        </label>
      </section>

      {loading && (
        <div className="rounded-[4px] border-[0.5px] border-ivory-border bg-card p-5 text-sm text-ink-mid">
          Running optimiser...
        </div>
      )}
      {error && (
        <div className="rounded-[4px] border-[0.5px] border-terracotta/25 bg-card p-5 text-sm text-terracotta">
          {error}
        </div>
      )}

      {!loading && data && (
        <>
          <section className="grid gap-3 md:grid-cols-3">
            {cards.map((c) => (
              <article
                key={c.label}
                className="rounded-[4px] border-[0.5px] border-ivory-border bg-card p-4"
              >
                <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-mid">
                  {c.label}
                </p>
                <p className="mt-2 text-sm text-ink-mid">Before {formatGbp(c.before)}</p>
                <p className="text-sm text-ink-mid">After {formatGbp(c.after)}</p>
                <p className="mt-2 font-serif text-2xl text-[#1D6B4E]">
                  {formatGbp(c.delta)}
                </p>
              </article>
            ))}
          </section>

          <section className="rounded-[4px] border-[0.5px] border-ivory-border bg-card p-4">
            <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-mid">
              Recommended Package
            </p>
            {data.recommendations.length === 0 ? (
              <p className="mt-3 text-sm text-ink-mid">
                No hedge package improves the selected objective under current constraints.
              </p>
            ) : (
              <div className="mt-3 space-y-3">
                {data.recommendations.map((r, i) => (
                  <div
                    key={`${r.instrument}-${i}`}
                    className="rounded border border-ivory-border bg-paper p-3"
                  >
                    <p className="font-serif text-lg text-ink">
                      {r.direction} {r.size.toLocaleString("en-GB")} {r.unit} {r.instrument}
                    </p>
                    <p className="mt-1 text-sm text-ink-mid">{r.rationale}</p>
                    <p className="mt-1 text-xs text-ink-mid">
                      CVaR impact {formatGbp(r.impact.cvar95Reduction)} · VaR impact{" "}
                      {formatGbp(r.impact.var95Reduction)} · Confidence {r.confidence}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-[4px] border-[0.5px] border-ivory-border bg-card p-4">
            <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-mid">
              Alternative Packages
            </p>
            <div className="mt-3 space-y-2 text-sm text-ink-mid">
              {data.alternatives.map((alt) => (
                <p key={alt.rank}>
                  #{alt.rank}: {alt.trades.length} trade(s) · CVaR improvement{" "}
                  {formatGbp(alt.deltas.cvar95Reduction)} · Worst stress improvement{" "}
                  {formatGbp(alt.deltas.worstStressReduction)}
                </p>
              ))}
            </div>
          </section>

          <section className="rounded-[4px] border-[0.5px] border-ivory-border bg-card p-4 text-xs text-ink-mid">
            Scenarios: {data.diagnostics.scenarioCount} total (
            {data.diagnostics.historicalScenarioCount} historical,{" "}
            {data.diagnostics.stressScenarioCount} stress) · FX EUR/GBP{" "}
            {data.gbpPerEur.toFixed(4)} · Generated {new Date(data.generatedAt).toLocaleString()}
            {data.diagnostics.fallbackUsed && " · Fallback scenario set used"}
          </section>
        </>
      )}
    </div>
  );
}
