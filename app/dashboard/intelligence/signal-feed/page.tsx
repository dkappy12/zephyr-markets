"use client";

import { formatInTimeZone } from "date-fns-tz";
import { motion } from "framer-motion";
import { parseISO } from "date-fns";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import type { SignalRow } from "@/lib/signals";
import {
  formatReliabilityConfidenceDesk,
  reliabilityConfidenceFromRemitStalenessMinutes,
} from "@/lib/reliability/contract";
import {
  type AssetTab,
  type DedupedSignal,
  assetNameFromTitle,
  buildCapacityHeaderStats,
  classifyAssetType,
  dedupeByAsset,
  eventLabelFromTitle,
  impactScore,
  isActiveOutage,
  isOutageExpired,
  marketImplication,
  mwDeratedForRow,
  normalMwFromRaw,
  parseRemitDescription,
  severityForRow,
} from "@/lib/signal-feed";

const BRAND_GREEN = "#1D6B4E";
/** Zephyr terracotta — capacity derated, severity HIGH, warnings */
const TERRACOTTA = "#8B3A3A";
/** Deration bar fill: low / mid / high (non-colour label remains primary). */
function derationBarColor(pct: number): string {
  if (pct >= 99.5 || pct <= 0) return TERRACOTTA;
  if (pct >= 66) return "#9B3D20";
  if (pct >= 33) return "#B45309";
  return BRAND_GREEN;
}

const ASSET_TABS: AssetTab[] = [
  "ALL",
  "CCGT",
  "WIND",
  "NUCLEAR",
  "INTERCONNECTOR",
  "STORAGE",
  "OTHER",
];

const TAB_LABEL: Record<AssetTab, string> = {
  ALL: "All",
  CCGT: "CCGT",
  WIND: "Wind",
  NUCLEAR: "Nuclear",
  INTERCONNECTOR: "Interconnector",
  STORAGE: "Storage",
  OTHER: "Other",
};

type SortMode = "impact" | "time";

const sectionLabelClass =
  "text-[9px] font-semibold uppercase tracking-[0.16em] text-ink-mid";

function formatMw(n: number): string {
  return new Intl.NumberFormat("en-GB", {
    maximumFractionDigits: 0,
  }).format(Math.round(n));
}

function assetTypePillClass(t: Exclude<AssetTab, "ALL">): string {
  switch (t) {
    case "CCGT":
      return "border-amber-700/35 bg-amber-50/80 text-amber-900";
    case "WIND":
      return "border-emerald-700/30 bg-emerald-50/80 text-emerald-900";
    case "NUCLEAR":
      return "border-violet-700/30 bg-violet-50/80 text-violet-900";
    case "INTERCONNECTOR":
      return "border-cyan-700/30 bg-cyan-50/80 text-cyan-900";
    case "STORAGE":
      return "border-sky-700/30 bg-sky-50/80 text-sky-950";
    default:
      return "border-ivory-border bg-ivory text-ink-mid";
  }
}

function severityPillClass(s: "HIGH" | "MEDIUM" | "LOW"): string {
  switch (s) {
    case "HIGH":
      return "border-transparent bg-[#8B3A3A] text-white";
    case "MEDIUM":
      return "border-transparent bg-[#92400E] text-white";
    default:
      return "border-transparent bg-[#4B5320] text-white";
  }
}

function StructuredSignalCard({
  item,
  muted,
}: {
  item: DedupedSignal;
  muted: boolean;
}) {
  const { latest, updateCount, asset } = item;
  const titleAsset = assetNameFromTitle(latest.title);
  const event = eventLabelFromTitle(latest.title);
  const assetType = classifyAssetType(asset);
  const desc = latest.description ?? "";
  const parsed = parseRemitDescription(desc);
  const mw =
    mwDeratedForRow(latest) ??
    parsed.mwOffline ??
    null;
  const normal =
    normalMwFromRaw(latest.raw_data) ?? parsed.mwNormal ?? null;
  const planned = /\bPlanned\b/i.test(desc);
  const unplanned = /\bUnplanned\b/i.test(desc);
  const severity = severityForRow(latest, mw);
  const implication = marketImplication(
    assetType,
    mw,
    unplanned,
    planned,
  );

  const offlineStr =
    mw != null ? `${formatMw(mw)} MW offline` : "Capacity impact unknown";
  const normalStr =
    normal != null && normal > 0
      ? ` (of ${formatMw(normal)} MW normal capacity)`
      : "";

  const planStr = planned
    ? "Planned"
    : unplanned
      ? "Unplanned"
      : "Outage type unknown";
  const bits: string[] = [`${offlineStr}${normalStr}`, planStr];
  if (parsed.startDisplay) {
    bits.push(`Since ${parsed.startDisplay}`);
  }
  if (parsed.endDisplay) {
    bits.push(`Until ${parsed.endDisplay}`);
  }
  if (parsed.durationDisplay) {
    bits.push(parsed.durationDisplay);
  }
  const middleLine = bits.join(" · ");

  const der = mw ?? 0;
  const norm = normal ?? 0;
  let capacityBarLabel = "";
  let terrPct = 0;
  if (norm > 0) {
    terrPct = Math.min(100, Math.max(0, (der / norm) * 100));
    if (mw == null) capacityBarLabel = "";
    else if (der <= 0) capacityBarLabel = "RETURNED";
    else if (der >= norm) capacityBarLabel = "FULLY OFFLINE";
    else capacityBarLabel = `${Math.round((der / norm) * 100)}% derated`;
  } else if (mw !== null && der <= 0) {
    capacityBarLabel = "RETURNED";
  }

  const latestTime = formatInTimeZone(
    parseISO(latest.created_at),
    "UTC",
    "dd MMM yyyy HH:mm",
  );

  return (
    <article
      className={`rounded-[4px] border-[0.5px] border-ivory-border bg-card px-4 py-3 transition-opacity ${
        muted ? "opacity-[0.62]" : ""
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex flex-wrap items-center gap-2">
          <h3 className="font-sans text-base font-semibold leading-snug text-ink">
            {titleAsset || asset}
            {event ? (
              <span className="font-medium text-ink-mid"> — {event}</span>
            ) : null}
          </h3>
          <span
            className={`rounded-[3px] border-[0.5px] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] ${assetTypePillClass(assetType)}`}
          >
            {assetType}
          </span>
          <span
            className={`rounded-[3px] border-[0.5px] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] ${severityPillClass(severity)}`}
          >
            {severity}
          </span>
          {updateCount > 1 ? (
            <span className="rounded-[3px] border-[0.5px] border-ivory-border bg-ivory px-1.5 py-0.5 text-[9px] font-semibold tracking-[0.04em] text-ink-mid">
              {updateCount} updates
            </span>
          ) : null}
        </div>
        <time
          className="shrink-0 text-[11px] tabular-nums text-ink-light"
          dateTime={latest.created_at}
        >
          {latestTime} UTC
        </time>
      </div>
      <p
        className={`mt-2 text-sm leading-relaxed ${muted ? "text-ink-mid" : "text-ink"}`}
      >
        {middleLine}
      </p>

      {norm > 0 ? (
        <div className="mt-2">
          <div
            className="flex h-2 w-full overflow-hidden rounded-sm"
            style={{ backgroundColor: "#e5e1d9" }}
          >
            <div
              className="h-full shrink-0 rounded-sm transition-colors"
              style={{
                width: `${terrPct}%`,
                backgroundColor: derationBarColor(terrPct),
              }}
            />
          </div>
          {capacityBarLabel ? (
            <p className="mt-1 text-[10px] font-medium tabular-nums text-ink-mid">
              {capacityBarLabel}
            </p>
          ) : null}
        </div>
      ) : capacityBarLabel === "RETURNED" ? (
        <p className="mt-2 text-[10px] font-medium text-ink-mid">RETURNED</p>
      ) : null}

      <p
        className="mt-3 border-l-2 pl-3 text-[11px] italic leading-relaxed text-ink-light"
        style={{ borderColor: BRAND_GREEN }}
      >
        {implication}
      </p>
    </article>
  );
}

export default function SignalFeedPage() {
  const [rows, setRows] = useState<SignalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<AssetTab>("ALL");
  const [sortMode, setSortMode] = useState<SortMode>("impact");
  const [visibleCount, setVisibleCount] = useState(10);
  const [showCleared, setShowCleared] = useState(false);
  const [nowTs, setNowTs] = useState(() => Date.now());

  const loadSignals = useCallback(async () => {
    const supabase = createBrowserClient();
    const since = new Date(
      Date.now() - 60 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const { data, error: qError } = await supabase
      .from("signals")
      .select(
        "id, type, title, description, direction, source, confidence, created_at, raw_data",
      )
      .eq("type", "remit")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(5000);

    if (qError) {
      setError(qError.message);
      setRows([]);
      return;
    }
    setError(null);
    setRows((data ?? []) as SignalRow[]);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      void loadSignals().finally(() => {
        if (!cancelled) setLoading(false);
      });
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [loadSignals]);

  useEffect(() => {
    const supabase = createBrowserClient();
    const channel = supabase
      .channel("signal-feed-remit")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "signals" },
        (payload) => {
          const t = (payload.new as { type?: string })?.type;
          if (t === "remit") loadSignals();
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadSignals]);

  useEffect(() => {
    const t = setInterval(() => setNowTs(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const headerStats = useMemo(
    () => buildCapacityHeaderStats(rows, new Date()),
    [rows],
  );

  const deduped = useMemo(() => dedupeByAsset(rows), [rows]);

  /** Feed row: recent update (24h) OR still active — so long-running outages (e.g. LBAR-1) stay visible. */
  const feedVisible = useMemo(() => {
    const now = new Date();
    const cutoff24h = now.getTime() - 24 * 60 * 60 * 1000;
    return deduped.filter((d) => {
      const latest = d.latest;
      if (isOutageExpired(latest, now)) return showCleared;
      const recent =
        new Date(latest.created_at).getTime() >= cutoff24h;
      const active = isActiveOutage(latest, now);
      return recent || active;
    });
  }, [deduped, showCleared]);

  const filteredSorted = useMemo(() => {
    let list = feedVisible;
    if (activeTab !== "ALL") {
      list = list.filter((d) => classifyAssetType(d.asset) === activeTab);
    }
    const scored = list.map((d) => {
      const mw = mwDeratedForRow(d.latest);
      const assetType = classifyAssetType(d.asset);
      const impact = impactScore(d.latest, assetType, mw);
      const t = new Date(d.latest.created_at).getTime();
      return { d, impact, t };
    });
    scored.sort((a, b) => {
      if (sortMode === "impact") {
        if (b.impact !== a.impact) return b.impact - a.impact;
        return b.t - a.t;
      }
      return b.t - a.t;
    });
    return scored.map((x) => x.d);
  }, [feedVisible, activeTab, sortMode]);

  const paged = useMemo(
    () => filteredSorted.slice(0, visibleCount),
    [filteredSorted, visibleCount],
  );

  const allRecentCleared = useMemo(() => {
    const now = new Date();
    return (
      deduped.length > 0 &&
      !showCleared &&
      feedVisible.length === 0 &&
      deduped.every((d) => isOutageExpired(d.latest, now))
    );
  }, [deduped, feedVisible.length, showCleared]);
  const latestTs =
    rows.length > 0 ? new Date(rows[0]!.created_at).getTime() : null;
  const ageMinutes =
    latestTs != null
      ? Math.max(0, Math.floor((nowTs - latestTs) / 60000))
      : null;
  const reliability = formatReliabilityConfidenceDesk(
    reliabilityConfidenceFromRemitStalenessMinutes(ageMinutes),
  );

  return (
    <div className="space-y-8">
      <div>
        <motion.h1
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="font-serif text-3xl text-ink"
        >
          Signal feed
        </motion.h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-mid">
          Physical capacity events: deduplicated by asset, ranked by market
          impact, with structured REMIT parsing.
        </p>
      </div>

      {/* Capacity header */}
      <div className="rounded-[4px] border-[0.5px] border-ivory-border bg-card px-4 py-3">
        <p className={sectionLabelClass}>Signal reliability</p>
        <p className="mt-1 text-xs text-ink-mid">
          Confidence {reliability} · {ageMinutes == null ? "no recent data" : `${ageMinutes} min since latest REMIT update`}
        </p>
      </div>
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-wrap items-end gap-x-8 gap-y-3 border-b-[0.5px] border-ivory-border bg-ivory px-4 py-3 sm:px-5"
      >
        <div>
          <p className={sectionLabelClass}>Unplanned MW offline</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-ink">
            {loading ? "…" : `${formatMw(headerStats.unplannedMw)} MW`}
          </p>
        </div>
        <div>
          <p className={sectionLabelClass}>Planned MW offline</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-ink">
            {loading ? "…" : `${formatMw(headerStats.plannedMw)} MW`}
          </p>
        </div>
        <div>
          <p className={sectionLabelClass}>Assets affected</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-ink">
            {loading ? "…" : headerStats.distinctAssets}
          </p>
        </div>
        <div>
          <p className={sectionLabelClass}>Largest active outage</p>
          <p className="mt-1 text-sm font-semibold leading-snug text-ink">
            {loading ? "…" : headerStats.topOutageLabel ?? "—"}
          </p>
        </div>
      </motion.div>
      <p className="font-mono text-[10px] text-ink-light">
        Header stats aggregate deduped REMIT rows (no per-event timestamp).
        Staleness above reflects the latest row time; each card shows its own
        event timing.
      </p>

      {/* Filters + sort */}
      <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          {ASSET_TABS.map((t) => {
            const on = activeTab === t;
            return (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setActiveTab(t);
                  setVisibleCount(10);
                }}
                className={`rounded-[4px] border-[0.5px] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] transition-colors duration-200 ${
                  on
                    ? "border-ink bg-ivory-dark text-ink"
                    : "border-ivory-border bg-card text-ink-mid hover:border-ink/25"
                }`}
              >
                {TAB_LABEL[t]}
              </button>
            );
          })}
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-[11px] text-ink-mid">
          <input
            type="checkbox"
            checked={showCleared}
            onChange={(e) => {
              setShowCleared(e.target.checked);
              setVisibleCount(10);
            }}
            className="rounded border-ivory-border text-ink accent-[#8B3A3A]"
          />
          <span>Show cleared outages</span>
        </label>
        <div className="flex items-center gap-2 text-[11px] text-ink-mid">
          <span className="font-medium text-ink-light">Sort by:</span>
          {(["impact", "time"] as const).map((m) => {
            const on = sortMode === m;
            return (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setSortMode(m);
                  setVisibleCount(10);
                }}
                className={`rounded-[4px] border-[0.5px] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] ${
                  on
                    ? "border-ink bg-ivory-dark text-ink"
                    : "border-ivory-border bg-card text-ink-mid hover:border-ink/25"
                }`}
              >
                {m === "impact" ? "Impact" : "Time"}
              </button>
            );
          })}
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          <div className="h-24 animate-pulse rounded-[4px] border-[0.5px] border-ivory-border bg-ivory-dark" />
          <div className="h-24 animate-pulse rounded-[4px] border-[0.5px] border-ivory-border bg-ivory-dark" />
        </div>
      ) : error ? (
        <p className="text-sm text-bear">{error}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-ink-mid">
          No REMIT signals in the last 60 days. The ingestion pipeline may still
          be catching up.
        </p>
      ) : filteredSorted.length === 0 ? (
        <p className="text-sm text-ink-mid">
          {allRecentCleared && !showCleared
            ? "All recent outages have ended (cleared). Turn on “Show cleared outages” to see them muted below."
            : "No REMIT signals in the last 24h with the current filter."}
        </p>
      ) : (
        <>
          <div className="space-y-3">
            {paged.map((item) => (
              <motion.div
                key={item.latest.id}
                layout
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              >
                <StructuredSignalCard
                  item={item}
                  muted={isOutageExpired(item.latest, new Date())}
                />
              </motion.div>
            ))}
          </div>
          {visibleCount < filteredSorted.length ? (
            <div className="flex justify-center pt-2">
              <button
                type="button"
                onClick={() =>
                  setVisibleCount((c) =>
                    Math.min(c + 10, filteredSorted.length),
                  )
                }
                className="rounded-[4px] border-[0.5px] border-ivory-border bg-card px-4 py-2 text-xs font-medium text-ink-mid transition-colors hover:border-ink/25 hover:text-ink"
              >
                Load more ({filteredSorted.length - visibleCount} remaining)
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
