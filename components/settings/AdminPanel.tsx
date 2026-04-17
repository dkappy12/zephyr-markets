"use client";

import { createClient } from "@/lib/supabase/client";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type CoeffUpdate = {
  run_id: string;
  run_started_at: string;
  run_finished_at: string | null;
  n_observations: number;
  decision: string;
  reason: string;
  gate_results: Record<
    string,
    { pass: boolean; value?: number | string; threshold?: number | string }
  >;
  prior_coefficients: number[] | null;
  posterior_coefficients: number[] | null;
  runtime_ms: number | null;
};

type ModelVersion = {
  version: string;
  effective_from: string;
  change_summary: string;
  b1: number;
  b2: number;
  b3: number;
  b4: number;
  b5: number;
  w1: number;
  w2: number;
  w3: number;
  metric_mae: number | null;
  metric_bias: number | null;
  metric_sample_n: number | null;
};

type PipelineFeed = {
  feed_id: string;
  feed_name: string;
  category: string;
  last_success_ts: string | null;
  last_error: string | null;
  staleness_status: string;
  staleness_seconds: number | null;
  consecutive_failures: number;
  expected_cadence_seconds: number;
};

type Profile = {
  id: string;
  email: string | null;
  role: string;
  plan: string;
  created_at: string;
};

type Prediction = {
  target_date: string;
  target_settlement_period: number;
  regime: string;
  absolute_error_gbp_mwh: number;
  signed_error_gbp_mwh: number;
  model_version: string;
};

const COEFF_NAMES = ["b1", "b2", "b3", "b4", "b5", "w1", "w2", "w3"];
const COEFF_LABELS = [
  "RD 0-20GW",
  "RD 20-28GW",
  "RD 28-32GW",
  "RD 32-35GW",
  "RD >35GW",
  "Wind 0-5GW",
  "Wind 5-15GW",
  "Wind >15GW",
];
const KF_PRIORS = [0.0, 0.5, 1.5, 5.0, 20.0, 2.5, 1.8, 3.5];
const KF_MIN_DAYS = 10;

const DECISION_COLOUR: Record<string, string> = {
  promote: "text-[#1D6B4E]",
  reject: "text-ink-mid",
  flag_for_review: "text-[#92400E]",
  rollback: "text-[#8B3A3A]",
  no_change: "text-ink-light",
};

const DECISION_LABEL: Record<string, string> = {
  promote: "PROMOTED",
  reject: "REJECTED",
  flag_for_review: "FLAGGED",
  rollback: "ROLLED BACK",
  no_change: "NO CHANGE",
};

const STALENESS_COLOUR: Record<string, string> = {
  fresh: "text-[#1D6B4E]",
  stale: "text-[#92400E]",
  critical: "text-[#8B3A3A]",
  unknown: "text-ink-light",
};

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtStaleness(secs: number | null): string {
  if (secs == null) return "—";
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`;
  return `${Math.round(secs / 86400)}d ago`;
}

function Section({
  id,
  title,
  defaultOpen = false,
  children,
}: {
  id: string;
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div
      id={id}
      className="overflow-hidden rounded-[4px] border-[0.5px] border-ivory-border bg-card"
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-6 py-4 text-left transition-colors hover:bg-ivory-dark"
      >
        <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-mid">
          {title}
        </p>
        <span className="text-[10px] text-ink-light">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="border-t-[0.5px] border-ivory-border px-6 py-5">
          {children}
        </div>
      )}
    </div>
  );
}

export function AdminPanel() {
  const supabase = createClient();

  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [sisData, setSisData] = useState<{
    runs: CoeffUpdate[];
    currentVersion: ModelVersion | null;
    totalVersions: number;
  } | null>(null);
  const [pipelineFeeds, setPipelineFeeds] = useState<PipelineFeed[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);

      const [sisRes, pipelineRes] = await Promise.all([
        fetch("/api/admin/sis"),
        fetch("/api/admin/pipeline"),
      ]);

      if (sisRes.ok) setSisData(await sisRes.json());
      if (pipelineRes.ok) {
        const p = await pipelineRes.json();
        setPipelineFeeds(p.feeds ?? []);
      }

      const { data: preds } = await supabase
        .from("premium_predictions")
        .select(
          "target_date, target_settlement_period, regime, absolute_error_gbp_mwh, signed_error_gbp_mwh, model_version",
        )
        .eq("is_filled", true)
        .order("target_date", { ascending: false })
        .limit(1000);
      setPredictions((preds ?? []) as Prediction[]);

      const { data: profileData } = await supabase
        .from("profiles")
        .select("id, email, role, plan, created_at")
        .order("created_at", { ascending: false });
      setProfiles((profileData ?? []) as Profile[]);

      setLoading(false);
    }
    void load();
  }, [supabase]);

  const filled = predictions.filter((p) => p.absolute_error_gbp_mwh != null);

  const overallMAE =
    filled.length > 0
      ? filled.reduce((s, p) => s + Math.abs(Number(p.absolute_error_gbp_mwh)), 0) /
        filled.length
      : null;

  const overallBias =
    filled.length > 0
      ? filled.reduce((s, p) => s + Number(p.signed_error_gbp_mwh), 0) /
        filled.length
      : null;

  const regimeStats = ["gas-dominated", "transitional", "renewable"].map((r) => {
    const rows = filled.filter((p) => p.regime === r);
    const mae =
      rows.length > 0
        ? rows.reduce((s, p) => s + Math.abs(Number(p.absolute_error_gbp_mwh)), 0) /
          rows.length
        : null;
    return { regime: r, mae, n: rows.length };
  });

  const maeByHour = (() => {
    const buckets: Record<number, number[]> = {};
    for (let h = 0; h < 24; h++) buckets[h] = [];
    for (const p of filled) {
      const sp = Number(p.target_settlement_period);
      const hour = Math.floor(((sp - 1) * 30) / 60);
      buckets[hour].push(Math.abs(Number(p.absolute_error_gbp_mwh)));
    }
    return Object.entries(buckets).map(([hour, errs]) => ({
      hour: `${String(hour).padStart(2, "0")}:00`,
      mae:
        errs.length > 0 ? errs.reduce((s, e) => s + e, 0) / errs.length : null,
      n: errs.length,
    }));
  })();

  const filledDays = new Set(predictions.map((p) => p.target_date)).size;

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-16 animate-pulse rounded-[4px] border-[0.5px] border-ivory-border bg-card"
          />
        ))}
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="space-y-4"
    >
      <Section id="model" title="Model performance" defaultOpen={true}>
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              {
                label: "Overall MAE",
                value: overallMAE != null ? `£${overallMAE.toFixed(2)}` : "—",
                unit: "/MWh",
              },
              {
                label: "Bias",
                value:
                  overallBias != null
                    ? `${overallBias > 0 ? "+" : ""}£${overallBias.toFixed(2)}`
                    : "—",
                unit: "/MWh",
              },
              {
                label: "Filled predictions",
                value: filled.length.toLocaleString(),
                unit: "",
              },
              {
                label: "Days of data",
                value: filledDays.toString(),
                unit: ` of ${KF_MIN_DAYS} min`,
              },
            ].map(({ label, value, unit }) => (
              <div
                key={label}
                className="rounded-[4px] border-[0.5px] border-ivory-border bg-ivory p-4"
              >
                <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-ink-light">
                  {label}
                </p>
                <p className="mt-1 font-serif text-2xl text-ink">
                  {value}
                  {unit && (
                    <span className="ml-0.5 font-sans text-xs font-normal text-ink-mid">
                      {unit}
                    </span>
                  )}
                </p>
              </div>
            ))}
          </div>

          <div>
            <p className="mb-3 text-[9px] font-semibold uppercase tracking-[0.12em] text-ink-light">
              MAE by hour of day — diurnal error pattern
            </p>
            {maeByHour.some((d) => d.mae != null) ? (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart
                  data={maeByHour}
                  margin={{ top: 4, right: 8, bottom: 4, left: 0 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="#E8E4DC"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="hour"
                    tick={{ fontSize: 9, fill: "#9E9890" }}
                    tickLine={false}
                    axisLine={false}
                    interval={3}
                  />
                  <YAxis
                    tick={{ fontSize: 9, fill: "#9E9890" }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => `£${v}`}
                    width={36}
                  />
                  <Tooltip
                    formatter={(v: number) => [`£${v.toFixed(2)}/MWh`, "MAE"]}
                    contentStyle={{
                      fontSize: 11,
                      border: "0.5px solid #D4CCBB",
                      borderRadius: 4,
                      background: "#F5F0E8",
                    }}
                  />
                  <Bar dataKey="mae" radius={[2, 2, 0, 0]}>
                    {maeByHour.map((entry, i) => (
                      <Cell
                        key={i}
                        fill={
                          entry.mae == null
                            ? "#E8E4DC"
                            : entry.mae > 30
                              ? "#8B3A3A"
                              : entry.mae > 15
                                ? "#92400E"
                                : "#4a7c59"
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-ink-mid">No filled predictions yet.</p>
            )}
          </div>

          <div>
            <p className="mb-3 text-[9px] font-semibold uppercase tracking-[0.12em] text-ink-light">
              MAE by regime
            </p>
            <div className="divide-y-[0.5px] divide-ivory-border rounded-[4px] border-[0.5px] border-ivory-border">
              {regimeStats.map(({ regime, mae, n }) => (
                <div key={regime} className="flex items-center justify-between px-4 py-3">
                  <span className="capitalize text-sm text-ink">{regime}</span>
                  <div className="flex items-center gap-4">
                    <span className="font-mono text-xs text-ink-light">n={n}</span>
                    <span className="font-mono text-sm text-ink">
                      {mae != null ? `£${mae.toFixed(2)}/MWh` : "—"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Section>

      <Section id="sis" title="Self-improvement system (SIS)" defaultOpen={true}>
        <div className="space-y-5">
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-ink-light">
                Warm-up period
              </p>
              <span className="font-mono text-xs text-ink-mid">
                {filledDays} / {KF_MIN_DAYS} days
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-ivory-dark">
              <div
                className="h-full rounded-full bg-ink transition-all duration-500"
                style={{ width: `${Math.min(100, (filledDays / KF_MIN_DAYS) * 100)}%` }}
              />
            </div>
            <p className="mt-1.5 text-[10px] text-ink-light">
              {filledDays >= KF_MIN_DAYS
                ? "Warm-up complete. Kalman filter operating at full confidence."
                : `${KF_MIN_DAYS - filledDays} more day${KF_MIN_DAYS - filledDays === 1 ? "" : "s"} until full confidence. Blending with hand-tuned priors until then.`}
            </p>
          </div>

          {sisData?.currentVersion && (
            <div>
              <p className="mb-3 text-[9px] font-semibold uppercase tracking-[0.12em] text-ink-light">
                Current coefficients — {sisData.currentVersion.version}
              </p>
              <div className="divide-y-[0.5px] divide-ivory-border rounded-[4px] border-[0.5px] border-ivory-border">
                {COEFF_NAMES.map((name, i) => {
                  const v = sisData.currentVersion!;
                  const current = [v.b1, v.b2, v.b3, v.b4, v.b5, v.w1, v.w2, v.w3][i];
                  const prior = KF_PRIORS[i];
                  const delta = current - prior;
                  return (
                    <div key={name} className="flex items-center justify-between px-4 py-2.5">
                      <div>
                        <span className="font-mono text-xs text-ink">{name}</span>
                        <span className="ml-2 text-[10px] text-ink-light">
                          {COEFF_LABELS[i]}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-[10px] text-ink-light">
                          prior {prior.toFixed(3)}
                        </span>
                        <span className="font-mono text-sm text-ink">{current.toFixed(4)}</span>
                        {Math.abs(delta) > 0.001 && (
                          <span
                            className={`font-mono text-[10px] ${delta > 0 ? "text-[#1D6B4E]" : "text-[#8B3A3A]"}`}
                          >
                            {delta > 0 ? "+" : ""}
                            {delta.toFixed(4)}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <p className="mb-3 text-[9px] font-semibold uppercase tracking-[0.12em] text-ink-light">
              Run history — {sisData?.runs.length ?? 0} recorded
            </p>
            {sisData && sisData.runs.length > 0 ? (
              <div className="divide-y-[0.5px] divide-ivory-border rounded-[4px] border-[0.5px] border-ivory-border">
                {sisData.runs.map((run) => {
                  const expanded = expandedRun === run.run_id;
                  return (
                    <div key={run.run_id}>
                      <button
                        type="button"
                        onClick={() => setExpandedRun(expanded ? null : run.run_id)}
                        className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-ivory-dark"
                      >
                        <div className="flex items-center gap-3">
                          <span
                            className={`font-mono text-[9px] font-semibold uppercase tracking-[0.1em] ${DECISION_COLOUR[run.decision] ?? "text-ink-mid"}`}
                          >
                            {DECISION_LABEL[run.decision] ?? run.decision}
                          </span>
                          <span className="text-xs text-ink-mid">{fmtTime(run.run_started_at)}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="font-mono text-[10px] text-ink-light">
                            n={run.n_observations}
                          </span>
                          <span className="text-[10px] text-ink-light">{expanded ? "▲" : "▼"}</span>
                        </div>
                      </button>

                      {expanded && (
                        <div className="space-y-4 border-t-[0.5px] border-ivory-border bg-ivory px-4 py-4">
                          <div>
                            <p className="mb-1 text-[9px] font-semibold uppercase tracking-[0.1em] text-ink-light">
                              Reason
                            </p>
                            <p className="font-mono text-xs text-ink-mid">{run.reason}</p>
                          </div>

                          <div>
                            <p className="mb-2 text-[9px] font-semibold uppercase tracking-[0.1em] text-ink-light">
                              Gate results
                            </p>
                            <div className="divide-y-[0.5px] divide-ivory-border rounded-[4px] border-[0.5px] border-ivory-border">
                              {Object.entries(run.gate_results ?? {}).map(([gate, result]) => (
                                <div key={gate} className="flex items-center justify-between px-3 py-2">
                                  <span className="font-mono text-[10px] text-ink-mid">{gate}</span>
                                  <div className="flex items-center gap-2">
                                    {result.value != null && (
                                      <span className="font-mono text-[10px] text-ink-light">
                                        {String(result.value)}
                                      </span>
                                    )}
                                    {result.threshold != null && (
                                      <span className="font-mono text-[10px] text-ink-light">
                                        / {String(result.threshold)}
                                      </span>
                                    )}
                                    <span
                                      className={`rounded-[2px] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] ${
                                        result.pass
                                          ? "bg-[#1D6B4E]/10 text-[#1D6B4E]"
                                          : "bg-[#8B3A3A]/10 text-[#8B3A3A]"
                                      }`}
                                    >
                                      {result.pass ? "PASS" : "FAIL"}
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>

                          {run.prior_coefficients && run.posterior_coefficients && (
                            <div>
                              <p className="mb-2 text-[9px] font-semibold uppercase tracking-[0.1em] text-ink-light">
                                Coefficients
                              </p>
                              <div className="divide-y-[0.5px] divide-ivory-border rounded-[4px] border-[0.5px] border-ivory-border">
                                {COEFF_NAMES.map((name, i) => {
                                  const prior = Number(run.prior_coefficients![i]);
                                  const post = Number(run.posterior_coefficients![i]);
                                  const delta = post - prior;
                                  return (
                                    <div key={name} className="flex items-center justify-between px-3 py-2">
                                      <span className="font-mono text-[10px] text-ink">{name}</span>
                                      <div className="flex items-center gap-2 font-mono text-[10px]">
                                        <span className="text-ink-light">{prior.toFixed(4)}</span>
                                        <span className="text-ink-light">→</span>
                                        <span className="text-ink">{post.toFixed(4)}</span>
                                        {Math.abs(delta) > 0.0001 && (
                                          <span className={delta > 0 ? "text-[#1D6B4E]" : "text-[#8B3A3A]"}>
                                            {delta > 0 ? "+" : ""}
                                            {delta.toFixed(4)}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          <p className="font-mono text-[9px] text-ink-light">
                            run_id: {run.run_id} ·{" "}
                            {run.runtime_ms != null ? `${run.runtime_ms}ms` : "—"}
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-ink-mid">
                No Kalman runs recorded yet. First run scheduled at 02:05 UTC tonight.
              </p>
            )}
          </div>
        </div>
      </Section>

      <Section id="users" title="User analytics">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Total users", value: profiles.length },
              {
                label: "Free",
                value: profiles.filter((u) => u.plan === "free" && u.role !== "admin").length,
              },
              { label: "Pro", value: profiles.filter((u) => u.plan === "pro").length },
              { label: "Team", value: profiles.filter((u) => u.plan === "team").length },
            ].map(({ label, value }) => (
              <div
                key={label}
                className="rounded-[4px] border-[0.5px] border-ivory-border bg-ivory p-4"
              >
                <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-ink-light">
                  {label}
                </p>
                <p className="mt-1 font-serif text-2xl text-ink">{value}</p>
              </div>
            ))}
          </div>

          <div className="divide-y-[0.5px] divide-ivory-border rounded-[4px] border-[0.5px] border-ivory-border">
            {profiles.map((u) => (
              <div key={u.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-sm text-ink">{u.email ?? "—"}</p>
                  <p className="text-[10px] text-ink-light">
                    Joined{" "}
                    {u.created_at
                      ? new Date(u.created_at).toLocaleDateString("en-GB", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        })
                      : "—"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-[3px] border-[0.5px] border-ivory-border bg-ivory px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-ink-mid">
                    {u.role}
                  </span>
                  <span className="rounded-[3px] border-[0.5px] border-ivory-border bg-ivory px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-ink-mid">
                    {u.plan}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Section>

      <Section id="pipeline" title="Pipeline health">
        {pipelineFeeds.length > 0 ? (
          <div className="divide-y-[0.5px] divide-ivory-border rounded-[4px] border-[0.5px] border-ivory-border">
            {pipelineFeeds.map((feed) => (
              <div key={feed.feed_id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-sm text-ink">{feed.feed_name}</p>
                  <p className="text-[10px] text-ink-light">
                    {feed.last_success_ts
                      ? `Last success: ${fmtStaleness(feed.staleness_seconds)}`
                      : "Never succeeded"}
                    {feed.consecutive_failures > 0 &&
                      ` · ${feed.consecutive_failures} consecutive failure${feed.consecutive_failures > 1 ? "s" : ""}`}
                  </p>
                  {feed.last_error && (
                    <p className="mt-0.5 font-mono text-[10px] text-[#8B3A3A]">
                      {feed.last_error}
                    </p>
                  )}
                </div>
                <span
                  className={`font-mono text-[9px] font-semibold uppercase tracking-[0.1em] ${STALENESS_COLOUR[feed.staleness_status] ?? "text-ink-light"}`}
                >
                  {feed.staleness_status}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-ink-mid">
              Pipeline health data not yet populated. The ingestion agent writes to this
              table as each feed runs — data will appear after the next deploy.
            </p>
            <p className="text-xs text-ink-light">
              8 feeds configured: Elexon BMRS, EEX NGP, Stooq NBP, Sheffield PV-Live,
              Elexon FUELINST, GIE AGSI, Frankfurter FX, Open-Meteo.
            </p>
          </div>
        )}
      </Section>
    </motion.div>
  );
}
