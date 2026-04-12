"use client";

import { createBrowserClient } from "@/lib/supabase/client";
import { parseISO } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";

const LOC_ORDER = ["DE", "FR", "NL", "AT"] as const;
const BULL = "#1d6b4e";
const INK = "#2c2a26";
const INK_MID = "#6b6760";

function parseNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

type MidRow = {
  price_gbp_mwh: number;
  settlement_period: number;
  price_date: string;
  market: string;
  fetched_at: string | null;
};

type TapeRow = MidRow;

type GasRow = {
  price_eur_mwh: number;
  price_time: string;
};

type StorageRow = {
  location: string;
  full_pct: number | null;
  working_volume_twh: number | null;
  report_date: string;
};

/** Prefer N2EX over APX when both exist for the same settlement. */
function dedupeMidBySettlement(rows: MidRow[]): MidRow[] {
  const m = new Map<string, MidRow>();
  for (const r of rows) {
    const k = `${r.price_date}-${r.settlement_period}`;
    const cur = m.get(k);
    if (!cur) {
      m.set(k, r);
      continue;
    }
    if (r.market === "N2EX") m.set(k, r);
    else if (cur.market !== "N2EX") m.set(k, r);
  }
  return Array.from(m.values()).sort((a, b) => {
    if (a.price_date !== b.price_date) {
      return b.price_date.localeCompare(a.price_date);
    }
    return b.settlement_period - a.settlement_period;
  });
}

function srmcGbpMwh(ttfEur: number): number {
  return (ttfEur * 0.86) / 2.931 / 0.5 + 26 + 2;
}

function sparkSpreadGbpMwh(n2ex: number, ttfEur: number): number {
  return n2ex - srmcGbpMwh(ttfEur);
}

export default function MarketsPage() {
  const [loading, setLoading] = useState(true);
  const [midRows, setMidRows] = useState<MidRow[]>([]);
  const [gasRow, setGasRow] = useState<GasRow | null>(null);
  const [storageRows, setStorageRows] = useState<StorageRow[]>([]);
  const [tapeRows, setTapeRows] = useState<TapeRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createBrowserClient();

    async function load() {
      setLoadError(null);
      try {
        const [mpRes, gasRes, stRes, tapeRes] = await Promise.all([
          supabase
            .from("market_prices")
            .select(
              "price_gbp_mwh, settlement_period, price_date, market, fetched_at",
            )
            .or("market.eq.N2EX,market.eq.APX")
            .order("price_date", { ascending: false })
            .order("settlement_period", { ascending: false })
            .limit(80),
          supabase
            .from("gas_prices")
            .select("price_eur_mwh, price_time")
            .eq("hub", "TTF")
            .order("price_time", { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase
            .from("storage_levels")
            .select("location, full_pct, working_volume_twh, report_date")
            .in("location", [...LOC_ORDER])
            .order("report_date", { ascending: false }),
          supabase
            .from("market_prices")
            .select(
              "price_gbp_mwh, settlement_period, price_date, market, fetched_at",
            )
            .or("market.eq.N2EX,market.eq.APX")
            .order("fetched_at", { ascending: false })
            .limit(10),
        ]);

        if (mpRes.error) {
          setLoadError(mpRes.error.message);
          setMidRows([]);
        } else {
          const raw = (mpRes.data ?? []) as Record<string, unknown>[];
          const parsed: MidRow[] = raw.map((r) => ({
            price_gbp_mwh: parseNum(r.price_gbp_mwh) ?? 0,
            settlement_period: Number(r.settlement_period) || 0,
            price_date: String(r.price_date ?? ""),
            market: String(r.market ?? ""),
            fetched_at: r.fetched_at != null ? String(r.fetched_at) : null,
          }));
          setMidRows(dedupeMidBySettlement(parsed).slice(0, 48));
        }

        if (gasRes.error) {
          setGasRow(null);
        } else if (gasRes.data) {
          const g = gasRes.data as Record<string, unknown>;
          const pe = parseNum(g.price_eur_mwh);
          if (pe != null) {
            setGasRow({
              price_eur_mwh: pe,
              price_time: String(g.price_time ?? ""),
            });
          } else {
            setGasRow(null);
          }
        } else {
          setGasRow(null);
        }

        if (stRes.error) {
          setStorageRows([]);
        } else {
          const raw = (stRes.data ?? []) as Record<string, unknown>[];
          const seen = new Set<string>();
          const latest: StorageRow[] = [];
          for (const r of raw) {
            const loc = String(r.location ?? "");
            if (!LOC_ORDER.includes(loc as (typeof LOC_ORDER)[number])) continue;
            if (seen.has(loc)) continue;
            seen.add(loc);
            latest.push({
              location: loc,
              full_pct: parseNum(r.full_pct),
              working_volume_twh: parseNum(r.working_volume_twh),
              report_date: String(r.report_date ?? ""),
            });
          }
          setStorageRows(latest);
        }

        if (tapeRes.error) {
          setTapeRows([]);
        } else {
          const raw = (tapeRes.data ?? []) as Record<string, unknown>[];
          setTapeRows(
            raw.map((r) => ({
              price_gbp_mwh: parseNum(r.price_gbp_mwh) ?? 0,
              settlement_period: Number(r.settlement_period) || 0,
              price_date: String(r.price_date ?? ""),
              market: String(r.market ?? ""),
              fetched_at: r.fetched_at != null ? String(r.fetched_at) : null,
            })),
          );
        }
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "Load failed");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  const chartSeries = useMemo(() => {
    const slice = [...midRows].reverse();
    return slice.map((r, i) => ({
      sp: r.settlement_period,
      price: r.price_gbp_mwh,
      idx: i,
    }));
  }, [midRows]);

  const latestN2ex = midRows[0]?.price_gbp_mwh ?? null;
  const sixAgo = midRows[6]?.price_gbp_mwh ?? null;

  const trendPct =
    latestN2ex != null &&
    sixAgo != null &&
    sixAgo !== 0 &&
    midRows.length > 6
      ? ((latestN2ex - sixAgo) / sixAgo) * 100
      : null;

  const ttfEur = gasRow?.price_eur_mwh ?? null;
  const spark =
    latestN2ex != null && ttfEur != null
      ? sparkSpreadGbpMwh(latestN2ex, ttfEur)
      : null;

  const storageByLoc = useMemo(() => {
    const o: Record<string, StorageRow> = {};
    for (const r of storageRows) {
      o[r.location] = r;
    }
    return o;
  }, [storageRows]);

  const storageChartData = useMemo(
    () =>
      LOC_ORDER.map((loc) => {
        const r = storageByLoc[loc];
        return {
          loc,
          label: loc,
          full_pct: r?.full_pct ?? 0,
        };
      }),
    [storageByLoc],
  );

  const storageAvg = useMemo(() => {
    const pcts = LOC_ORDER.map((l) => storageByLoc[l]?.full_pct).filter(
      (v): v is number => v != null && Number.isFinite(v),
    );
    if (pcts.length === 0) return null;
    return pcts.reduce((a, b) => a + b, 0) / pcts.length;
  }, [storageByLoc]);

  const gbDisplay = loading
    ? "…"
    : latestN2ex == null
      ? "—"
      : `£${latestN2ex.toFixed(2)}/MWh`;

  const ttfDisplay = loading
    ? "…"
    : ttfEur == null
      ? "—"
      : `€${ttfEur.toFixed(2)}/MWh`;

  const gasUpdated =
    gasRow?.price_time != null && gasRow.price_time !== ""
      ? formatInTimeZone(parseISO(gasRow.price_time), "UTC", "dd MMM yyyy HH:mm") +
        " UTC"
      : null;

  return (
    <div className="space-y-8">
      <div>
        <motion.h1
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="font-serif text-3xl text-ink"
        >
          Markets
        </motion.h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-mid">
          Curves and spreads that matter for physical premia in GB and NW
          Europe.
        </p>
      </div>

      {loadError ? (
        <p className="text-sm text-bear">{loadError}</p>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-2">
        {/* Card 1 — GB Power */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28 }}
          className="rounded-[4px] border-[0.5px] border-ivory-border bg-card px-5 py-4"
        >
          <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-mid">
            GB Power
          </p>
          <p className="mt-2 font-serif text-2xl tabular-nums text-ink">
            {gbDisplay}
          </p>
          <p className="mt-1 text-[11px] text-ink-mid">
            N2EX Day-ahead · APX Mid
          </p>
          {trendPct != null ? (
            <p
              className={`mt-1 text-xs tabular-nums ${
                trendPct >= 0 ? "text-bull" : "text-bear"
              }`}
            >
              {trendPct >= 0 ? "↑" : "↓"}{" "}
              {trendPct >= 0 ? "+" : ""}
              {trendPct.toFixed(1)}% vs 6 periods ago
            </p>
          ) : (
            <p className="mt-1 text-xs text-ink-light">—</p>
          )}
          <div className="mt-3 h-20 w-full">
            {chartSeries.length > 0 ? (
              <ResponsiveContainer width="100%" height={80}>
                <AreaChart
                  data={chartSeries}
                  margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
                >
                  <XAxis dataKey="sp" hide />
                  <YAxis hide domain={["dataMin - 2", "dataMax + 2"]} />
                  <Area
                    type="monotone"
                    dataKey="price"
                    stroke={INK}
                    strokeWidth={1}
                    fill={INK}
                    fillOpacity={0.12}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-20 items-center text-xs text-ink-light">
                No intraday curve yet
              </div>
            )}
          </div>
        </motion.div>

        {/* Card 2 — TTF */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05, duration: 0.28 }}
          className="rounded-[4px] border-[0.5px] border-ivory-border bg-card px-5 py-4"
        >
          <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-mid">
            TTF gas
          </p>
          <p className="mt-2 font-serif text-2xl tabular-nums text-ink">
            {ttfDisplay}
          </p>
          <p className="mt-2 text-sm text-ink-mid">EEX NGP</p>
          <p className="mt-3 text-[11px] text-ink-light">
            {gasUpdated != null ? `Updated ${gasUpdated}` : "—"}
          </p>
        </motion.div>

        {/* Card 3 — Spark */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.28 }}
          className="rounded-[4px] border-[0.5px] border-ivory-border bg-card px-5 py-4"
        >
          <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-mid">
            Clean spark spread
          </p>
          <p
            className={`mt-2 font-serif text-2xl tabular-nums ${
              spark == null
                ? "text-ink"
                : spark >= 0
                  ? "text-bull"
                  : "text-bear/90"
            }`}
          >
            {loading
              ? "…"
              : spark == null
                ? "—"
                : `£${spark.toFixed(2)}/MWh`}
          </p>
          {spark != null ? (
            <p
              className={`mt-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${
                spark >= 0 ? "text-bull" : "text-bear/90"
              }`}
            >
              {spark >= 0 ? "In merit" : "Out of merit"}
            </p>
          ) : null}
          <p className="mt-2 text-xs text-ink-mid">
            Implied CCGT margin vs gas cost + carbon
          </p>
        </motion.div>

        {/* Card 4 — EU Storage */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.28 }}
          className="rounded-[4px] border-[0.5px] border-ivory-border bg-card px-5 py-4"
        >
          <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-mid">
            EU storage
          </p>
          <p className="mt-2 font-serif text-2xl tabular-nums text-ink">
            {loading
              ? "…"
              : storageAvg == null
                ? "—"
                : `${storageAvg.toFixed(1)}% avg`}
          </p>
          <p className="mt-1 font-mono text-[11px] text-ink-mid">
            {LOC_ORDER.map((loc) => {
              const p = storageByLoc[loc]?.full_pct;
              return `${loc} ${p == null ? "—" : `${Math.round(p)}%`}`;
            }).join(" · ")}
          </p>
          <div className="mt-3 h-[100px] w-full">
            {storageChartData.some((d) => d.full_pct > 0) ? (
              <ResponsiveContainer width="100%" height={100}>
                <BarChart
                  layout="vertical"
                  data={storageChartData}
                  margin={{ top: 4, right: 12, bottom: 4, left: 4 }}
                >
                  <XAxis type="number" domain={[0, 100]} hide />
                  <YAxis
                    type="category"
                    dataKey="label"
                    width={28}
                    tick={{ fill: INK_MID, fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Bar
                    dataKey="full_pct"
                    fill={BULL}
                    fillOpacity={0.55}
                    radius={[0, 2, 2, 0]}
                    isAnimationActive={false}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-[100px] items-center text-xs text-ink-light">
                No storage data
              </div>
            )}
          </div>
        </motion.div>
      </div>

      {/* Live tape */}
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.28 }}
        className="rounded-[4px] border-[0.5px] border-ivory-border bg-card px-5 py-4"
      >
        <h2 className="font-serif text-lg text-ink">Live tape</h2>
        <p className="mt-1 text-[11px] text-ink-mid">
          Last 10 settlement periods · APX/N2EX MID
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[480px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b-[0.5px] border-ivory-border text-[9px] font-semibold uppercase tracking-[0.12em] text-ink-light">
                <th className="pb-2 pr-4 font-medium">Time</th>
                <th className="pb-2 pr-4 font-medium">Settlement period</th>
                <th className="pb-2 pr-4 font-medium">Price</th>
                <th className="pb-2 font-medium">Volume</th>
              </tr>
            </thead>
            <tbody>
              {tapeRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    className="py-4 text-ink-mid"
                  >
                    {loading ? "…" : "No rows yet"}
                  </td>
                </tr>
              ) : (
                tapeRows.map((r, i) => (
                  <tr
                    key={`${r.price_date}-${r.settlement_period}-${r.market}-${i}`}
                    className="border-b-[0.5px] border-ivory-border/70 last:border-0"
                  >
                    <td className="py-2 pr-4 tabular-nums text-ink-mid">
                      {r.fetched_at != null
                        ? formatInTimeZone(
                            parseISO(r.fetched_at),
                            "UTC",
                            "HH:mm:ss",
                          ) + " UTC"
                        : "—"}
                    </td>
                    <td className="py-2 pr-4 tabular-nums text-ink">
                      {r.settlement_period}
                    </td>
                    <td className="py-2 pr-4 tabular-nums text-ink">
                      £{r.price_gbp_mwh.toFixed(2)}/MWh
                    </td>
                    <td
                      className="py-2 tabular-nums text-ink-light"
                      title="Volume not available in MID feed"
                    >
                      —
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </motion.section>
    </div>
  );
}
