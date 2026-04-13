"use client";

import { motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { MetricCard } from "@/components/ui/MetricCard";
import { SignalCard, type SignalCardProps } from "@/components/ui/SignalCard";
import { TopoBackground } from "@/components/ui/TopoBackground";
import { createBrowserClient } from "@/lib/supabase/client";
import {
  dedupeSignalRowsByTitleDescription,
  type SignalRow,
  signalRowToCardProps,
} from "@/lib/signals";

type CardWithId = SignalCardProps & { id: string };

/** 17 GW approximate output at 8 m/s mean wind → linear scale to GW. */
const MS_TO_GW = 17 / 8;

const EU_STORAGE_LOCATIONS = ["DE", "FR", "IT", "NL", "AT"] as const;
const EU_LABELS: Record<(typeof EU_STORAGE_LOCATIONS)[number], string> = {
  DE: "Germany",
  FR: "France",
  IT: "Italy",
  NL: "Netherlands",
  AT: "Austria",
};

function formatPct(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "—";
  return `${Math.round(v)}%`;
}

/** Always show sign, one decimal (e.g. +1.8, -0.3, +0.0). */
function formatSignedNormalisedScore(n: number): string {
  const abs = Math.abs(n).toFixed(1);
  if (n > 0) return `+${abs}`;
  if (n < 0) return `-${abs}`;
  return "+0.0";
}

const PREMIUM_DIRECTION_LABEL: Record<string, string> = {
  FIRMING: "Firming",
  SOFTENING: "Softening",
  STABLE: "Stable",
};

/** PostgREST may return numeric columns as number or string. */
function parsePhysicalPremiumScore(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return Number.NaN;
}

export default function OverviewPage() {
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const relTimeRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [preview, setPreview] = useState<CardWithId[]>([]);
  const [remit24h, setRemit24h] = useState<number | null>(null);
  const [deFullPct, setDeFullPct] = useState<number | null>(null);
  const [euFillByLoc, setEuFillByLoc] = useState<
    Partial<Record<(typeof EU_STORAGE_LOCATIONS)[number], number | null>>
  >({});
  const [windGw, setWindGw] = useState<number | null>(null);
  const [solarGw, setSolarGw] = useState<number | null>(null);
  const [premiumLoading, setPremiumLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [relativeNowMs, setRelativeNowMs] = useState(() => new Date().getTime());
  const [premiumRow, setPremiumRow] = useState<{
    normalised_score: number;
    direction: string;
  } | null>(null);

  useEffect(() => {
    const supabase = createBrowserClient();
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const nowIso = new Date().toISOString();

    async function load() {
      setLoading(true);
      const [
        sigRes,
        countRes,
        deStorageRes,
        euStorageRes,
        windRes,
        solarRes,
        premiumRes,
      ] = await Promise.all([
        supabase
          .from("signals")
          .select(
            "id, type, title, description, direction, source, confidence, created_at, raw_data",
          )
          .order("created_at", { ascending: false })
          .limit(32),
        supabase
          .from("signals")
          .select("*", { count: "exact", head: true })
          .eq("type", "remit")
          .gte("created_at", since),
        supabase
          .from("storage_levels")
          .select("full_pct")
          .eq("location", "DE")
          .order("report_date", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("storage_levels")
          .select("location, full_pct, report_date")
          .in("location", [...EU_STORAGE_LOCATIONS])
          .order("report_date", { ascending: false })
          .limit(40),
        supabase
          .from("weather_forecasts")
          .select("wind_speed_100m, forecast_time")
          .eq("location", "GB")
          .lte("forecast_time", nowIso)
          .order("forecast_time", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("solar_outturn")
          .select("solar_mw, datetime_gmt")
          .order("datetime_gmt", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("physical_premium")
          .select(
            "normalised_score, direction, implied_price_gbp_mwh, market_price_gbp_mwh, calculated_at",
          )
          .order("calculated_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      if (!sigRes.error && sigRes.data) {
        const deduped = dedupeSignalRowsByTitleDescription(
          sigRes.data as SignalRow[],
        ).slice(0, 4);
        setPreview(deduped.map(signalRowToCardProps));
      }
      if (countRes.error) {
        setRemit24h(null);
      } else {
        setRemit24h(countRes.count ?? 0);
      }

      if (!deStorageRes.error && deStorageRes.data) {
        const p = deStorageRes.data.full_pct;
        setDeFullPct(
          typeof p === "number" ? p : p != null ? Number(p) : null,
        );
      } else {
        setDeFullPct(null);
      }

      if (!euStorageRes.error && euStorageRes.data?.length) {
        const latest: Partial<
          Record<(typeof EU_STORAGE_LOCATIONS)[number], number | null>
        > = {};
        for (const row of euStorageRes.data) {
          const loc = row.location as (typeof EU_STORAGE_LOCATIONS)[number];
          if (!EU_STORAGE_LOCATIONS.includes(loc) || latest[loc] !== undefined) {
            continue;
          }
          const p = row.full_pct;
          latest[loc] =
            typeof p === "number" ? p : p != null ? Number(p) : null;
        }
        setEuFillByLoc(latest);
      } else {
        setEuFillByLoc({});
      }

      if (!windRes.error && windRes.data) {
        const w = windRes.data.wind_speed_100m;
        const ms =
          typeof w === "number" ? w : w != null ? Number(w) : Number.NaN;
        setWindGw(Number.isFinite(ms) ? ms * MS_TO_GW : null);
      } else {
        setWindGw(null);
      }

      if (!solarRes.error && solarRes.data) {
        const sm = solarRes.data.solar_mw;
        const mw =
          typeof sm === "number" ? sm : sm != null ? Number(sm) : Number.NaN;
        setSolarGw(Number.isFinite(mw) ? mw / 1000 : null);
      } else {
        setSolarGw(null);
      }

      const nsRaw = premiumRes.data?.normalised_score;
      const score = parsePhysicalPremiumScore(nsRaw);

      if (!premiumRes.error && premiumRes.data) {
        const dirRaw = premiumRes.data.direction;
        const dir =
          typeof dirRaw === "string" ? dirRaw.trim().toUpperCase() : "";
        if (Number.isFinite(score)) {
          setPremiumRow({ normalised_score: score, direction: dir });
        } else {
          setPremiumRow(null);
        }
      } else {
        setPremiumRow(null);
      }
      setPremiumLoading(false);
      setUpdatedAt(new Date());
      setLoading(false);
    }

    void load();
    pollRef.current = setInterval(() => {
      void load();
    }, 180000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  useEffect(() => {
    relTimeRef.current = setInterval(() => {
      setRelativeNowMs(new Date().getTime());
    }, 30000);
    return () => {
      if (relTimeRef.current) clearInterval(relTimeRef.current);
    };
  }, []);

  const updatedAgoLabel = useMemo(() => {
    if (updatedAt == null) return "—";
    const sec = Math.max(0, Math.floor((relativeNowMs - updatedAt.getTime()) / 1000));
    if (sec < 60) return "Updated just now";
    const min = Math.floor(sec / 60);
    if (min < 60) return `Updated ${min} min ago`;
    const hr = Math.floor(min / 60);
    return `Updated ${hr}h ago`;
  }, [updatedAt, relativeNowMs]);

  const euTooltip = (
    <ul className="space-y-1">
      {EU_STORAGE_LOCATIONS.map((code) => (
        <li key={code} className="flex justify-between gap-6">
          <span className="text-ink-mid">{EU_LABELS[code]}</span>
          <span className="font-medium tabular-nums text-ink">
            {formatPct(euFillByLoc[code] ?? null)}
          </span>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="space-y-10">
      <div>
        <motion.h1
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28 }}
          className="font-serif text-3xl text-ink"
        >
          Overview
        </motion.h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-mid">
          Physical premium, system fundamentals, and the signals that move your
          book today.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Wind generation"
          value={windGw === null ? "—" : windGw.toFixed(1)}
          unit="GW"
          trend={windGw === null ? undefined : "flat"}
        />
        <MetricCard
          label="EU storage"
          value={deFullPct === null ? "—" : String(Math.round(deFullPct))}
          unit="% full"
          trend="flat"
          hoverDetail={euTooltip}
        />
        <MetricCard
          label="SOLAR GENERATION"
          value={solarGw === null ? "—" : solarGw.toFixed(1)}
          unit="GW"
        />
        <MetricCard
          label="REMIT alerts"
          value={remit24h === null ? "—" : String(remit24h)}
          unit="last 24h"
          trend={
            remit24h === null
              ? undefined
              : remit24h > 0
                ? "up"
                : "flat"
          }
        />
      </div>

      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.32, delay: 0.05 }}
        className="relative overflow-visible rounded-[4px] border-[0.5px] border-gold/45 bg-card px-6 py-6"
      >
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[4px]">
          <TopoBackground className="h-full w-full" lineOpacity={0.25} />
        </div>
        <div className="relative z-[1] flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-gold">
              <span className="inline-flex items-center">
                Physical premium
                <span className="group relative ml-1.5 inline-flex shrink-0 align-middle">
                  <span
                    className="cursor-help select-none text-xs font-normal normal-case tracking-normal text-gray-500"
                    aria-label="Physical premium score explained"
                  >
                    ⓘ
                  </span>
                  <span
                    role="tooltip"
                    className="pointer-events-none absolute bottom-full left-1/2 z-[9999] mb-1 w-max max-w-[280px] -translate-x-1/2 rounded-[6px] border border-[#D4CCBB] bg-[#F5F0E8] px-3 py-[10px] text-left text-[12px] font-normal normal-case leading-snug tracking-normal text-[#3D3D2E] opacity-0 shadow-[0_4px_12px_rgba(0,0,0,0.1)] transition-opacity duration-150 group-hover:opacity-100"
                  >
                    <span className="block">
                      The physical premium score measures how far the market price
                      has diverged from our model&apos;s physically-implied price.
                    </span>
                    <span className="mt-3 block">
                      Negative = market overpriced vs fundamentals (SOFTENING)
                    </span>
                    <span className="mt-1 block">
                      Positive = market underpriced vs fundamentals (FIRMING)
                    </span>
                    <span className="mt-3 block">
                      ±1 moderate · ±2 significant · ±4 extreme
                    </span>
                  </span>
                </span>
              </span>
            </p>
            <p className="mt-2 font-serif text-5xl leading-none text-ink tabular-nums">
              {premiumLoading
                ? "…"
                : premiumRow
                  ? formatSignedNormalisedScore(premiumRow.normalised_score)
                  : "--"}
            </p>
            <p className="mt-2 text-sm text-ink-mid">
              Normalised gap between market-implied and physically-implied price.
            </p>
          </div>
          {!premiumLoading &&
            premiumRow &&
            PREMIUM_DIRECTION_LABEL[premiumRow.direction] && (
              <span className="inline-flex w-fit items-center rounded-[2px] border-[0.5px] border-gold/50 bg-ivory px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-gold">
                {PREMIUM_DIRECTION_LABEL[premiumRow.direction]}
              </span>
            )}
        </div>
      </motion.section>

      <section className="space-y-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="font-serif text-xl text-ink">Signal feed</h2>
            <p className="text-xs text-ink-mid">
              Latest physical drivers with desk relevance.
            </p>
            <p className="mt-1 text-[10px] text-ink-light">{updatedAgoLabel}</p>
            {loading && preview.length > 0 ? (
              <p className="text-[10px] text-ink-light">Refreshing...</p>
            ) : null}
          </div>
        </div>
        <div className="grid gap-3">
          {preview.length === 0 ? (
            <p className="text-sm text-ink-mid">
              No signals yet. The ingestion pipeline is running.
            </p>
          ) : (
            preview.map(({ id, ...card }) => (
              <SignalCard key={id} {...card} />
            ))
          )}
        </div>
      </section>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="rounded-[4px] border-[0.5px] border-gold/45 bg-card px-5 py-4"
      >
        <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-gold">
          Portfolio
        </p>
        <p className="mt-2 font-serif text-lg text-ink">
          Import positions for book-native scoring.
        </p>
        <p className="mt-1 text-sm text-ink-mid">
          Upload a curve snapshot or positions file. Zephyr maps signals to
          your exposures.
        </p>
        <button
          type="button"
          className="mt-4 rounded-[4px] border-[0.5px] border-gold/50 bg-ivory px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-gold transition-colors duration-200 hover:bg-ivory-dark"
        >
          Import portfolio
        </button>
      </motion.div>
    </div>
  );
}
