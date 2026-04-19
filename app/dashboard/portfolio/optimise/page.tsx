"use client";

import { TierGate } from "@/components/billing/TierGate";
import {
  rechartsTooltipContentStyle,
  rechartsTooltipItemStyle,
  rechartsTooltipLabelStyle,
} from "@/lib/charts/recharts-tooltip-styles";
import type { HedgeTrade } from "@/lib/portfolio/optimise";
import { createBrowserClient } from "@/lib/supabase/client";
import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Label,
  LabelList,
  ReferenceLine,
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
  const [openAlternatives, setOpenAlternatives] = useState<Record<number, boolean>>({});
  const [currentTier, setCurrentTier] = useState<"free" | "pro" | "team" | null>(null);

  useEffect(() => {
    fetch("/api/billing/status")
      .then((r) => r.json())
      .then((body: { effectiveTier?: string }) => {
        const t = body.effectiveTier;
        setCurrentTier(t === "pro" || t === "team" ? t : "free");
      })
      .catch(() => setCurrentTier("free"));
  }, []);

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
    <TierGate
      requiredTier="pro"
      currentTier={currentTier}
      featureName="Portfolio Optimiser"
      description="Scenario-based hedge recommendations with explicit risk reduction metrics. Available on the Pro plan."
      mockup={
        <div className="space-y-4 p-6">
          <div className="h-9 w-32 rounded bg-ink/10" />
          <div className="h-4 w-80 rounded bg-ink/8" />
          <div className="rounded-[4px] border border-ivory-border bg-card p-4">
            <div className="mb-2 h-3 w-24 rounded bg-ink/10" />
            <div className="mb-2 h-5 w-20 rounded bg-amber-600/30" />
            <div className="flex gap-2">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-2 w-12 rounded bg-ink/15" />
              ))}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {["VAR 95", "CVAR 95", "WORST STRESS"].map((l) => (
              <div key={l} className="rounded-[4px] border border-ivory-border bg-card p-4">
                <div className="mb-3 h-3 w-16 rounded bg-ink/10" />
                <div className="mb-2 h-8 w-24 rounded bg-[#1D6B4E]/20" />
                <div className="h-2 w-full rounded bg-[#1D6B4E]/30" />
              </div>
            ))}
          </div>
          <div className="h-48 rounded-[4px] border border-ivory-border bg-card p-4" />
          <div className="space-y-2">
            {[...Array(2)].map((_, i) => (
              <div key={i} className="h-24 rounded-[4px] border border-ivory-border bg-card p-4" />
            ))}
          </div>
        </div>
      }
    >
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

      <section className="grid gap-3 md:grid-cols-4">
        <label className="text-xs text-ink-mid">
          <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-mid">
            Objective
          </span>
          <select
            value={objective}
            onChange={(e) => setObjective(e.target.value as "cvar" | "var")}
            className="mt-2 w-full rounded-[4px] border-[0.5px] border-ivory-border bg-transparent px-3 py-2 text-sm text-ink outline-none transition-colors hover:bg-ivory-dark/40 focus:bg-ivory-dark/40"
          >
            <option value="cvar">Minimise CVaR 95</option>
            <option value="var">Minimise VaR 95</option>
          </select>
        </label>
        <label className="text-xs text-ink-mid">
          <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-mid">
            Confidence
          </span>
          <select
            value={confidence}
            onChange={(e) => setConfidence(Number(e.target.value))}
            className="mt-2 w-full rounded-[4px] border-[0.5px] border-ivory-border bg-transparent px-3 py-2 text-sm text-ink outline-none transition-colors hover:bg-ivory-dark/40 focus:bg-ivory-dark/40"
          >
            <option value={0.95}>95%</option>
            <option value={0.99}>99%</option>
          </select>
        </label>
        <label className="text-xs text-ink-mid">
          <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-mid">
            Max trades
          </span>
          <select
            value={maxTrades}
            onChange={(e) => setMaxTrades(Number(e.target.value))}
            className="mt-2 w-full rounded-[4px] border-[0.5px] border-ivory-border bg-transparent px-3 py-2 text-sm text-ink outline-none transition-colors hover:bg-ivory-dark/40 focus:bg-ivory-dark/40"
          >
            <option value={1}>1</option>
            <option value={2}>2</option>
            <option value={3}>3</option>
            <option value={4}>4</option>
          </select>
        </label>
        <div className="flex items-end">
          <label className="flex w-full items-center justify-between gap-3 rounded-[4px] border-[0.5px] border-ivory-border bg-transparent px-3 py-2">
            <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-mid">
              Stress scenarios
            </span>
            <input
              type="checkbox"
              checked={includeStress}
              onChange={(e) => setIncludeStress(e.target.checked)}
              className="h-5 w-9 appearance-none rounded-full border border-ivory-border bg-ivory transition-colors checked:border-[#1D6B4E]/40 checked:bg-[#1D6B4E]/25"
            />
          </label>
        </div>
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
          <section className="rounded-[4px] border-[0.5px] border-ivory-border bg-card p-5">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-mid">
                  Model quality
                </p>
                <p
                  className={`mt-2 font-serif text-3xl tracking-tight ${
                    data.quality === "high"
                      ? "text-[#1D6B4E]"
                      : data.quality === "medium"
                        ? "text-amber-700"
                        : "text-[#8B3A3A]"
                  }`}
                >
                  {data.quality.toUpperCase()}
                </p>
                <div className="mt-3 flex w-full max-w-[240px] gap-1">
                  {(["low", "medium", "high"] as const).map((level) => {
                    const isActive = data.quality === level;
                    const activeColor =
                      level === "high"
                        ? "bg-[#1D6B4E]"
                        : level === "medium"
                          ? "bg-amber-700"
                          : "bg-[#8B3A3A]";
                    return (
                      <div
                        key={level}
                        className={`h-2 flex-1 rounded-full border-[0.5px] border-ivory-border ${
                          isActive ? activeColor : "bg-ivory-border/40"
                        }`}
                        aria-hidden
                      />
                    );
                  })}
                </div>
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <div className="rounded-[4px] border-[0.5px] border-ivory-border bg-paper px-3 py-2">
                  <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-ink-light">
                    Total scenarios
                  </p>
                  <p className="mt-1 font-serif text-xl text-ink tabular-nums">
                    {data.diagnostics.scenarioCount}
                  </p>
                </div>
                <div className="rounded-[4px] border-[0.5px] border-ivory-border bg-paper px-3 py-2">
                  <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-ink-light">
                    Coverage
                  </p>
                  <p className="mt-1 font-serif text-xl text-ink tabular-nums">
                    {data.reliability ? `${Math.round(data.reliability.coverage * 100)}%` : "—"}
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-4 space-y-1">
              <p className="text-xs text-ink-mid">
                Stability {data.diagnostics.stabilityPass ? "PASS" : "WATCH"} · Index{" "}
                {data.diagnostics.stabilityIndex.toFixed(3)}
                {data.diagnostics.guardrailFilteredCount > 0
                  ? ` · ${data.diagnostics.guardrailFilteredCount} package(s) filtered`
                  : ""}
              </p>
              {data.qualityWarnings.length > 0 ? (
                <div className="mt-2 space-y-1">
                  {data.qualityWarnings.map((w) => (
                    <p key={w} className="text-xs text-ink-light">
                      {w}
                    </p>
                  ))}
                </div>
              ) : null}
            </div>
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
              <div className="mt-3 h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ top: 10, right: 12, bottom: 8, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(44,42,38,0.08)" />
                    <XAxis
                      type="number"
                      dataKey="x"
                      tick={{ fontSize: 10, fill: "#6b6560" }}
                      tickFormatter={(v) => `£${Math.round(Number(v)).toLocaleString("en-GB")}`}
                      axisLine={false}
                      tickLine={false}
                    >
                      <Label
                        value={`${tailRiskAxisLabel} (£)`}
                        position="insideBottom"
                        offset={-2}
                        style={{ fill: "#6b6560", fontSize: 10 }}
                      />
                    </XAxis>
                    <YAxis
                      type="number"
                      dataKey="y"
                      allowDecimals={false}
                      tick={{ fontSize: 10, fill: "#6b6560" }}
                      axisLine={false}
                      tickLine={false}
                    >
                      <Label
                        value="Trades"
                        angle={-90}
                        position="insideLeft"
                        style={{ fill: "#6b6560", fontSize: 10 }}
                      />
                    </YAxis>
                    <Tooltip
                      contentStyle={rechartsTooltipContentStyle}
                      labelStyle={rechartsTooltipLabelStyle}
                      itemStyle={rechartsTooltipItemStyle}
                      formatter={(v, n) =>
                        n === "x"
                          ? [
                              `£${Math.round(Number(v)).toLocaleString("en-GB")}`,
                              tailRiskAxisLabel,
                            ]
                          : n === "y" && Number(v) === 0
                            ? ["Current (unhedged)", "Position"]
                            : [Math.round(Number(v)), "Trades"]
                      }
                    />
                    <ReferenceLine
                      x={frontierData.recommended[0]?.x}
                      stroke="rgba(29,107,78,0.35)"
                      strokeDasharray="4 4"
                    />
                    <Scatter data={frontierData.alternatives} fill="#6b6560" />
                    <Scatter
                      data={frontierData.current}
                      fill="#8B3A3A"
                      shape={(props) => <circle {...props} r={8} />}
                    >
                      <LabelList
                        position="bottom"
                        offset={12}
                        fontSize={10}
                        fill="#6b6560"
                        valueAccessor={() => "Current book"}
                      />
                    </Scatter>
                    <Scatter
                      data={frontierData.recommended}
                      fill="#1D6B4E"
                      shape={(props) => <circle {...props} r={6} />}
                    >
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
                className="rounded-[4px] border-[0.5px] border-ivory-border bg-card p-5"
              >
                <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-mid">
                  {c.label}
                </p>
                <div className="mt-3 space-y-1">
                  <p className="text-xs text-ink-mid">Before {formatGbp(c.before)}</p>
                  <p className="text-xs text-ink-mid">After {formatGbp(c.after)}</p>
                </div>
                <div className="mt-4">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-ivory-border/50">
                    <div
                      className="h-full rounded-full bg-[#1D6B4E]/70"
                      style={{
                        width: `${Math.max(
                          0,
                          Math.min(
                            100,
                            c.before > 0 ? (1 - c.after / c.before) * 100 : 0,
                          ),
                        )}%`,
                      }}
                      aria-hidden
                    />
                  </div>
                </div>
                <p className="mt-4 font-serif text-2xl text-[#1D6B4E]">
                  {formatGbp(c.delta)}
                </p>
                <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-light">
                  {Math.round(
                    Math.max(0, Math.min(100, c.before > 0 ? (1 - c.after / c.before) * 100 : 0)),
                  )}
                  % reduction
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
                {data.diagnostics.noActionReason ??
                  "No hedge package improves the selected objective under current constraints."}
              </p>
            ) : (
              <div className="mt-3 space-y-3">
                {data.recommendations.map((r, i) => (
                  <div
                    key={`${r.instrument}-${i}`}
                    className="relative overflow-hidden rounded-[4px] border-[0.5px] border-ivory-border bg-paper p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] ${
                          r.direction === "BUY"
                            ? "bg-[#1D6B4E]/10 text-[#1D6B4E]"
                            : "bg-[#8B3A3A]/10 text-[#8B3A3A]"
                        }`}
                      >
                        {r.direction}
                      </span>
                      <span
                        className={`rounded-[3px] border-[0.5px] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] ${
                          r.confidence === "High"
                            ? "border-[#1D6B4E]/25 bg-[#1D6B4E]/10 text-[#1D6B4E]"
                            : r.confidence === "Low"
                              ? "border-amber-700/25 bg-amber-700/10 text-amber-800"
                              : "border-ivory-border bg-ivory text-ink-mid"
                        }`}
                      >
                        {r.confidence.toUpperCase()}
                      </span>
                    </div>
                    <p className="font-serif text-lg text-ink">
                      {r.size.toLocaleString("en-GB")} {r.unit} {r.instrument}
                    </p>
                    <p className="mt-2 text-[13px] italic leading-relaxed text-ink-mid">
                      {r.rationale}
                    </p>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <div className="rounded-[4px] border-[0.5px] border-ivory-border bg-ivory px-3 py-2">
                        <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-ink-light">
                          CVaR impact
                        </p>
                        <p className="mt-1 font-serif text-lg text-[#1D6B4E]">
                          {formatGbp(r.impact.cvar95Reduction)}
                        </p>
                      </div>
                      <div className="rounded-[4px] border-[0.5px] border-ivory-border bg-ivory px-3 py-2">
                        <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-ink-light">
                          VaR impact
                        </p>
                        <p className="mt-1 font-serif text-lg text-[#1D6B4E]">
                          {formatGbp(r.impact.var95Reduction)}
                        </p>
                      </div>
                    </div>
                    <p className="mt-1 text-xs text-ink-mid">
                      Constraints: {r.constraintsApplied.join(" · ")}
                    </p>
                    <button
                      type="button"
                      className="mt-3 inline-flex items-center gap-2 rounded-[4px] border-[0.5px] border-ivory-border bg-ivory px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-mid transition-colors hover:bg-ivory-dark hover:text-ink"
                      onClick={() =>
                        setOpenScenarios((prev) => ({
                          ...prev,
                          [`${r.instrument}-${i}`]: !prev[`${r.instrument}-${i}`],
                        }))
                      }
                    >
                      {openScenarios[`${r.instrument}-${i}`] ? "Hide scenarios" : "Show scenarios"}
                      <span className="text-xs">
                        {openScenarios[`${r.instrument}-${i}`] ? "▴" : "▾"}
                      </span>
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
            {data.alternatives.length === 0 ? (
              <p className="mt-3 text-sm text-ink-mid">No alternatives available.</p>
            ) : (
              <div className="mt-3 grid gap-2">
                {data.alternatives.map((alt) => (
                  <div
                    key={alt.rank}
                    className="group rounded-[4px] border-[0.5px] border-ivory-border bg-paper px-4 py-3 transition-colors hover:bg-ivory-dark"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <div className="flex min-w-0 flex-1 flex-col gap-2">
                        <div className="flex items-center gap-3">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-[0.5px] border-ivory-border bg-ivory font-mono text-[11px] text-ink">
                            #{alt.rank}
                          </span>
                          <div>
                            <p className="text-sm text-ink">
                              {alt.trades.length} trade{alt.trades.length === 1 ? "" : "s"}
                            </p>
                            <p className="text-[10px] text-ink-light">Click to see trades</p>
                          </div>
                        </div>
                        <button
                          type="button"
                          className="inline-flex w-fit items-center gap-2 rounded-[4px] border-[0.5px] border-ivory-border bg-ivory px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-mid transition-colors hover:bg-ivory-dark hover:text-ink"
                          onClick={() =>
                            setOpenAlternatives((prev) => ({
                              ...prev,
                              [alt.rank]: !prev[alt.rank],
                            }))
                          }
                        >
                          {openAlternatives[alt.rank] ? "Hide trades" : "Show trades"}
                          <span className="text-xs">{openAlternatives[alt.rank] ? "▴" : "▾"}</span>
                        </button>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="rounded-[4px] border-[0.5px] border-ivory-border bg-ivory px-3 py-2">
                          <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-ink-light">
                            CVaR
                          </p>
                          <p className="mt-1 font-serif text-sm text-[#1D6B4E]">
                            {formatGbp(alt.deltas.cvar95Reduction)}
                          </p>
                        </div>
                        <div className="rounded-[4px] border-[0.5px] border-ivory-border bg-ivory px-3 py-2">
                          <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-ink-light">
                            Worst stress
                          </p>
                          <p className="mt-1 font-serif text-sm text-[#1D6B4E]">
                            {formatGbp(alt.deltas.worstStressReduction)}
                          </p>
                        </div>
                        <div className="rounded-[4px] border-[0.5px] border-ivory-border bg-ivory px-3 py-2">
                          <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-ink-light">
                            VaR
                          </p>
                          <p className="mt-1 font-serif text-sm text-[#1D6B4E]">
                            {formatGbp(alt.deltas.var95Reduction)}
                          </p>
                        </div>
                      </div>
                    </div>
                    {openAlternatives[alt.rank] ? (
                      <div className="mt-3 border-t-[0.5px] border-ivory-border pt-3">
                        {!alt.trades || alt.trades.length === 0 ? (
                          <p className="text-xs text-ink-light">Trade details unavailable</p>
                        ) : (
                          <div className="space-y-2">
                            {alt.trades.map((t, ti) => (
                              <div
                                key={`${alt.rank}-${t.market}-${ti}`}
                                className="flex flex-wrap items-center gap-3"
                              >
                                <span
                                  className={`inline-flex shrink-0 items-center rounded-full px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] ${
                                    t.direction === "BUY"
                                      ? "bg-[#1D6B4E]/10 text-[#1D6B4E]"
                                      : "bg-[#8B3A3A]/10 text-[#8B3A3A]"
                                  }`}
                                >
                                  {t.direction}
                                </span>
                                <p className="font-serif text-sm text-ink">
                                  {t.size.toLocaleString("en-GB")} {t.unit} {t.market}
                                </p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="border-t-[0.5px] border-ivory-border pt-4 text-[11px] text-ink-light">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span>
                Scenarios {data.diagnostics.scenarioCount} (hist {data.diagnostics.historicalScenarioCount} ·
                stress {data.diagnostics.stressScenarioCount})
              </span>
              <span className="text-ink-light/50">·</span>
              <span>FX EUR/GBP {data.gbpPerEur.toFixed(4)}</span>
              <span className="text-ink-light/50">·</span>
              <span>Generated {new Date(data.generatedAt).toLocaleString()}</span>
              {data.diagnostics.fallbackUsed ? (
                <>
                  <span className="text-ink-light/50">·</span>
                  <span>Fallback scenario set</span>
                </>
              ) : null}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span>Power {data.provenance.power}</span>
              <span className="text-ink-light/50">·</span>
              <span>Gas {data.provenance.gas}</span>
              <span className="text-ink-light/50">·</span>
              <span>FX {data.provenance.fx}</span>
              {data.provenance.sinceDate != null && data.provenance.windowDays != null ? (
                <>
                  <span className="text-ink-light/50">·</span>
                  <span>
                    Window {data.provenance.windowDays}d from {data.provenance.sinceDate}
                  </span>
                </>
              ) : null}
            </div>
          </section>
        </>
      )}
      </div>
    </TierGate>
  );
}
