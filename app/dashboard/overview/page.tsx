"use client";

import { motion } from "framer-motion";
import { MetricCard } from "@/components/ui/MetricCard";
import { SignalCard } from "@/components/ui/SignalCard";
import { TopoBackground } from "@/components/ui/TopoBackground";

const signals = [
  {
    tone: "bull" as const,
    type: "flow" as const,
    title: "GB: Nemo +180 MW vs day-ahead",
    description:
      "Imports through Nemo tighten the GB baseload stack. IFA2 ramp on schedule. Watch wind into peak for spark drag.",
    source: "National Grid",
    timestamp: "09:14 GMT",
    confidence: "High",
  },
  {
    tone: "bear" as const,
    type: "weather" as const,
    title: "Wind +1.2 GW vs run",
    description:
      "Met desk revision lifts front-weighted wind from hour 12 to 18. CCGT peak load factor under pressure.",
    source: "ECMWF blend",
    timestamp: "08:47 GMT",
    confidence: "Med",
  },
  {
    tone: "watch" as const,
    type: "lng" as const,
    title: "DES offers thin, NW Europe queue",
    description:
      "Three vessels inside three days of UK terminals. NBP TTF spread the clean read on marginal LNG.",
    source: "AIS + brokers",
    timestamp: "Yesterday",
    confidence: "Watch",
  },
  {
    tone: "neutral" as const,
    type: "alert" as const,
    title: "REMIT: 460 MW CCGT derate",
    description:
      "Unit partially offline. Return window not filed. Peak UK Power and spark spreads bid on uncertainty.",
    source: "REMIT",
    timestamp: "07:02 GMT",
    confidence: "Confirmed",
  },
];

export default function OverviewPage() {
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
        <MetricCard label="Wind generation" value="12.8" unit="GW" trend="up" />
        <MetricCard
          label="EU storage"
          value="82"
          unit="% full"
          trend="flat"
        />
        <MetricCard label="LNG vessels" value="14" unit="in region" />
        <MetricCard label="REMIT alerts" value="3" unit="open" trend="up" />
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
            <p className="mt-2 font-serif text-5xl leading-none text-ink">
              +1.8
            </p>
            <p className="mt-2 text-sm text-ink-mid">
              Normalised gap between market-implied and physically-implied price.
            </p>
          </div>
          <span className="inline-flex w-fit items-center rounded-[2px] border-[0.5px] border-gold/50 bg-ivory px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-gold">
            Firming
          </span>
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
          {signals.map((s) => (
            <SignalCard key={s.title} {...s} />
          ))}
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
