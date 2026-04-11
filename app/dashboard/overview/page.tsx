"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { MetricCard } from "@/components/ui/MetricCard";
import { SignalCard, type SignalCardProps } from "@/components/ui/SignalCard";
import { TopoBackground } from "@/components/ui/TopoBackground";
import { createBrowserClient } from "@/lib/supabase/client";
import { type SignalRow, signalRowToCardProps } from "@/lib/signals";

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
  const [preview, setPreview] = useState<CardWithId[]>([]);
  const [remit24h, setRemit24h] = useState<number | null>(null);
  const [deFullPct, setDeFullPct] = useState<number | null>(null);
  const [euFillByLoc, setEuFillByLoc] = useState<
    Partial<Record<(typeof EU_STORAGE_LOCATIONS)[number], number | null>>
  >({});
  const [windGw, setWindGw] = useState<number | null>(null);
  const [premiumLoading, setPremiumLoading] = useState(true);
  const [premiumRow, setPremiumRow] = useState<{
    normalised_score: number;
    direction: string;
  } | null>(null);

  useEffect(() => {
    const supabase = createBrowserClient();
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const nowIso = new Date().toISOString();

    async function load() {
      const [
        sigRes,
        countRes,
        deStorageRes,
        euStorageRes,
        windRes,
        premiumRes,
      ] = await Promise.all([
        supabase
          .from("signals")
          .select(
            "id, type, title, description, direction, source, confidence, created_at, raw_data",
          )
          .order("created_at", { ascending: false })
          .limit(4),
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
          .from("physical_premium")
          .select(
            "normalised_score, direction, implied_price_gbp_mwh, market_price_gbp_mwh, calculated_at",
          )
          .order("calculated_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      if (!sigRes.error && sigRes.data) {
        setPreview((sigRes.data as SignalRow[]).map(signalRowToCardProps));
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

      console.log(
        "[physical_premium] raw data:",
        premiumRes.data,
        "error:",
        premiumRes.error,
      );
      const nsRaw = premiumRes.data?.normalised_score;
      const score = parsePhysicalPremiumScore(nsRaw);
      console.log("[physical_premium] parsed normalised_score:", score);

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
    }

    load();
  }, []);

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
          label="vessel tracking"
          value="Coming soon"
          valueClassName="font-sans text-lg font-medium leading-snug text-ink-light md:text-xl"
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
        className="relative overflow-hidden rounded-[4px] border-[0.5px] border-gold/45 bg-card px-6 py-6"
      >
        <div className="pointer-events-none absolute inset-0">
          <TopoBackground className="h-full w-full" lineOpacity={0.25} />
        </div>
        <div className="relative z-[1] flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-gold">
              Physical premium
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
