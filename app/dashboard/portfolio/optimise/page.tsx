"use client";

import type { HedgeTrade } from "@/lib/portfolio/optimise";
import { PREMIUM_VS_TAPE } from "@/lib/portfolio/desk-copy";
import { createBrowserClient } from "@/lib/supabase/client";
import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type ApiResponse = {
  generatedAt: string;
  objective: "cvar" | "var";
  confidence: number;
  maxTrades: number;
  includeStress: boolean;
  gbpPerEur: number;
  quality: "high" | "medium" | "low";
  qualityWarnings: string[];
  blocked: boolean;
  blockedReason: string | null;
  reliability?: {
    model_version: string;
    data_version: string;
    fallback_used: boolean;
    coverage: number;
    confidence: "high" | "medium" | "low";
    evidence: string[];
    freshness_ts: string;
  };
  provenance: {
    power: string;
    gas: string;
    fx: string;
    windowDays?: number;
    sinceDate?: string;
  };
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
    scenarioBreakdown: Array<{
      scenarioLabel: string;
      pnlBefore: number;
      pnlAfter: number;
      improvement: number;
    }>;
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
    candidatePackageCount: number;
    nbpProxyUsed: boolean;
    stabilityIndex: number;
    stabilityPass: boolean;
    noAction: boolean;
    noActionReason: string | null;
    guardrailFilteredCount: number;
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
  const supabase = useMemo(() => createBrowserClient(), []);
  const [userId, setUserId] = useState<string | null | undefined>(undefined);
  const [objective, setObjective] = useState<"cvar" | "var">("cvar");
  const [confidence, setConfidence] = useState(0.95);
  const [maxTrades, setMaxTrades] = useState(3);
  const [includeStress, setIncludeStress] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [openScenarios, setOpenScenarios] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      setError(null);
      try {
        const { data: authData } = await supabase.auth.getUser();
        const uid = authData.user?.id ?? null;
        if (!cancelled) setUserId(uid);
        if (!uid) {
          if (!cancelled) {
            setData(null);
            setLoading(false);
          }
          return;
        }
        const params = new URLSearchParams({
          objective,
          confidence: String(confidence),
          maxTrades: String(maxTrades),
          includeStress: String(includeStress),
        });
        const res = await fetch(`/api/optimise/recommendations?${params.toString()}`);
        const body = (await res.json()) as ApiResponse | { error?: string };
        if (res.status === 401) {
          if (!cancelled) {
            setError("Sign in to view optimise recommendations.");
            setData(null);
          }
          return;
        }
        if (!res.ok) {
          throw new Error("error" in body ? String(body.error) : "Optimiser request failed");
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
  }, [supabase, objective, confidence, maxTrades, includeStress]);

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

  const gateChecks = useMemo(() => {
    if (!data) return [];
    return [
      {
        label: "Historical scenarios ≥ 20",
        pass: data.diagnostics.historicalScenarioCount >= 20,
        detail: `${data.diagnostics.historicalScenarioCount} available`,
      },
      {
        label: "Candidate packages ≥ 30",
        pass: data.diagnostics.candidatePackageCount >= 30,
        detail: `${data.diagnostics.candidatePackageCount} generated`,
      },
      {
        label: "Independent NBP history (no proxy)",
        pass: !data.diagnostics.nbpProxyUsed,
        detail: data.diagnostics.nbpProxyUsed
          ? "Missing dates detected"
          : "Independent history available",
      },
    ];
  }, [data]);

  const frontierData = useMemo(() => {
    if (!data) return null;
    const riskX = (m: { varLoss: number; cvarLoss: number }) =>
      objective === "cvar" ? m.cvarLoss : m.varLoss;
    return {
      current: [{ label: "Current", x: riskX(data.before), y: 0 }],
      recommended: [
        {
          label: "Recommended",
          x: riskX(data.after),
          y: data.recommendations.length,
        },
      ],
      alternatives: data.alternatives.map((alt) => ({
        label: `Alt #${alt.rank}`,
        x: riskX(alt.after),
        y: alt.trades.length,
      })),
    };
  }, [data, objective]);

  const tailRiskAxisLabel = objective === "cvar" ? "CVaR loss" : "VaR loss";

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

      {userId === null && !loading && (
        <p className="text-sm text-ink-mid">Sign in to view optimise recommendations.</p>
      )}

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

      {!loading && userId && data && (
        <>
          {data.blocked && (
            <section className="rounded-[4px] border-[0.5px] border-[#8B3A3A]/40 bg-[#8B3A3A]/5 p-4">
              <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[#8B3A3A]">
                Reliability Gate Active
              </p>
              <p className="mt-2 text-sm text-[#8B3A3A]">
                {data.blockedReason ?? "Recommendations are blocked at current model quality."}
              </p>
              {data.qualityWarnings.length > 0 && (
                <div className="mt-2 space-y-1">
                  {data.qualityWarnings.map((w) => (
                    <p key={w} className="text-xs text-ink-mid">
                      {w}
                    </p>
                  ))}
                </div>
              )}
              <div className="mt-3 space-y-1">
                {gateChecks.map((c) => (
                  <p key={c.label} className="text-xs text-ink-mid">
                    {c.pass ? "PASS" : "FAIL"} · {c.label} ({c.detail})
                  </p>
                ))}
              </div>
            </section>
          )}

          <section className="rounded-[4px] border-[0.5px] border-ivory-border bg-card p-4">
            <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-mid">
              Model Quality
            </p>
            <p
              className={`mt-2 text-sm ${
                data.quality === "high"
                  ? "text-[#1D6B4E]"
                  : data.quality === "medium"
                    ? "text-amber-700"
                    : "text-[#8B3A3A]"
              }`}
            >
              {data.quality.toUpperCase()}
            </p>
            <p className="mt-1 text-xs text-ink-mid">
              Historical return scenarios {data.diagnostics.historicalScenarioCount} · Candidate
              packages {data.diagnostics.candidatePackageCount}
            </p>
            {(data.diagnostics.fallbackUsed || data.diagnostics.historicalScenarioCount === 0) && (
              <p className="mt-1 text-xs text-ink-mid">
                With no aligned historical window, empirical tail uses the same stress baseline as
                the Risk tab; total scenario count still includes stress tests.
              </p>
            )}
            <p className="mt-1 text-[10px] leading-snug text-ink-light">
              {PREMIUM_VS_TAPE} Optimiser quality gates mirror the reliability
              contract (coverage, fallback, freshness).
            </p>
            {data.reliability ? (
              <p className="mt-1 text-xs text-ink-mid">
                Reliability: {data.reliability.confidence.toUpperCase()} · Coverage{" "}
                {Math.round(data.reliability.coverage * 100)}% ·{" "}
                {data.reliability.fallback_used ? "Fallback active" : "Model mode"}
              </p>
            ) : null}
            <p className="mt-1 text-xs text-ink-mid">
              Stability {data.diagnostics.stabilityPass ? "PASS" : "WATCH"} · Index{" "}
              {data.diagnostics.stabilityIndex.toFixed(3)}
              {data.diagnostics.guardrailFilteredCount > 0
                ? ` · ${data.diagnostics.guardrailFilteredCount} package(s) filtered by stress guardrail`
                : ""}
            </p>
            {data.qualityWarnings.length > 0 && !data.blocked && (
              <div className="mt-2 space-y-1">
                {data.qualityWarnings.map((w) => (
                  <p key={w} className="text-xs text-ink-mid">
                    {w}
                  </p>
                ))}
              </div>
            )}
            {data.blocked && data.qualityWarnings.length > 0 && (
              <p className="mt-2 text-xs text-ink-mid">
                Warning details are listed in the reliability gate above.
              </p>
            )}
          </section>

          <section className="rounded-[4px] border-[0.5px] border-ivory-border bg-card p-4">
            <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-mid">
              Tail risk vs trade count
            </p>
            <p className="mt-1 text-[10px] leading-snug text-ink-light">
              Scatter of {objective === "cvar" ? "CVaR" : "VaR"} loss versus number of hedges — not a
              mean–variance efficient frontier.
            </p>
            {!frontierData || frontierData.alternatives.length === 0 ? (
              <p className="mt-3 text-sm text-ink-mid">
                No alternatives available yet for this view.
              </p>
            ) : (
              <div className="mt-2 h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ top: 10, right: 12, bottom: 8, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(44,42,38,0.08)" />
                    <XAxis
                      type="number"
                      dataKey="x"
                      tick={{ fontSize: 10, fill: "#6b6560" }}
                      tickFormatter={(v) => `£${Math.round(Number(v)).toLocaleString("en-GB")}`}
                    />
                    <YAxis
                      type="number"
                      dataKey="y"
                      allowDecimals={false}
                      tick={{ fontSize: 10, fill: "#6b6560" }}
                    />
                    <Tooltip
                      formatter={(v, n) =>
                        n === "x"
                          ? [
                              `£${Math.round(Number(v)).toLocaleString("en-GB")}`,
                              tailRiskAxisLabel,
                            ]
                          : [Math.round(Number(v)), "Trades"]
                      }
                    />
                    <Scatter data={frontierData.alternatives} fill="#6b6560" />
                    <Scatter data={frontierData.current} fill="#8B3A3A" shape="circle">
                      <LabelList dataKey="label" position="top" fontSize={11} fill="#2c2a26" />
                    </Scatter>
                    <Scatter data={frontierData.recommended} fill="#1D6B4E" shape="circle">
                      <LabelList dataKey="label" position="top" fontSize={11} fill="#2c2a26" />
                    </Scatter>
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>

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
            {data.blocked ? (
              <p className="mt-3 text-sm text-ink-mid">
                Recommendations are intentionally hidden until reliability improves.
              </p>
            ) : data.recommendations.length === 0 ? (
              <p className="mt-3 text-sm text-ink-mid">
                {data.diagnostics.noActionReason ??
                  "No hedge package improves the selected objective under current constraints."}
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
                    <p className="mt-1 text-xs text-ink-mid">
                      Constraints: {r.constraintsApplied.join(" · ")}
                    </p>
                    <button
                      type="button"
                      className="mt-2 text-xs text-ink-mid"
                      onClick={() =>
                        setOpenScenarios((prev) => ({
                          ...prev,
                          [`${r.instrument}-${i}`]: !prev[`${r.instrument}-${i}`],
                        }))
                      }
                    >
                      {openScenarios[`${r.instrument}-${i}`] ? "Hide scenarios ▴" : "Show scenarios ▾"}
                    </button>
                    {openScenarios[`${r.instrument}-${i}`] ? (
                      <div className="mt-2 overflow-x-auto">
                        <table className="w-full text-[11px] text-ink-mid">
                          <thead>
                            <tr>
                              <th className="py-1 text-left font-semibold">Scenario</th>
                              <th className="py-1 text-right font-semibold">Loss before</th>
                              <th className="py-1 text-right font-semibold">Loss after</th>
                              <th className="py-1 text-right font-semibold">Improvement</th>
                            </tr>
                          </thead>
                          <tbody>
                            {r.scenarioBreakdown.map((s) => (
                              <tr key={s.scenarioLabel}>
                                <td className="py-1">{s.scenarioLabel}</td>
                                <td className="py-1 text-right">{formatGbp(-s.pnlBefore)}</td>
                                <td className="py-1 text-right">{formatGbp(-s.pnlAfter)}</td>
                                <td className="py-1 text-right">{formatGbp(s.improvement)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-[4px] border-[0.5px] border-ivory-border bg-card p-4">
            <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-mid">
              Alternative Packages
            </p>
            {data.blocked ? (
              <p className="mt-3 text-sm text-ink-mid">
                Alternatives hidden while reliability gate is active.
              </p>
            ) : (
              <div className="mt-3 space-y-2 text-sm text-ink-mid">
                {data.alternatives.map((alt) => (
                  <p key={alt.rank}>
                    #{alt.rank}: {alt.trades.length} trade(s) · CVaR improvement{" "}
                    {formatGbp(alt.deltas.cvar95Reduction)} · Worst stress improvement{" "}
                    {formatGbp(alt.deltas.worstStressReduction)}
                  </p>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-[4px] border-[0.5px] border-ivory-border bg-card p-4 text-xs text-ink-mid">
            Scenarios: {data.diagnostics.scenarioCount} total (
            {data.diagnostics.historicalScenarioCount} historical,{" "}
            {data.diagnostics.stressScenarioCount} stress) · FX EUR/GBP{" "}
            {data.gbpPerEur.toFixed(4)} · Generated {new Date(data.generatedAt).toLocaleString()}
            {data.diagnostics.fallbackUsed && " · Fallback scenario set used"}
            <p className="mt-2">
              Provenance: Power {data.provenance.power} · Gas {data.provenance.gas} · FX{" "}
              {data.provenance.fx}
              {data.provenance.sinceDate != null && data.provenance.windowDays != null
                ? ` · Data window: ${data.provenance.windowDays} days from ${data.provenance.sinceDate}`
                : ""}
            </p>
          </section>
        </>
      )}
    </div>
  );
}
