"use client";

import { motion } from "framer-motion";
import { useState } from "react";
import { SignalCard } from "@/components/ui/SignalCard";

const filters = [
  "All",
  "GB Power",
  "Gas",
  "LNG",
  "Carbon",
  "REMIT",
] as const;

const rows = [
  {
    tone: "bull" as const,
    type: "flow" as const,
    title: "IFA2 ramp on schedule, DA spread flat",
    description:
      "Scheduled ramp aligns with published path. NBP front may lag if wind picks up into peak.",
    source: "Grid telemetry",
    timestamp: "10:02 GMT",
    confidence: "High",
    pnlImpact: "Model P&L: +£18k baseload strip",
  },
  {
    tone: "watch" as const,
    type: "lng" as const,
    title: "DES offers thinning",
    description:
      "Offer stack tighter than prior close. Marginal LNG pricing into NBP still the swing factor.",
    source: "Brokers + AIS",
    timestamp: "09:51 GMT",
    confidence: "Watch",
  },
  {
    tone: "bear" as const,
    type: "weather" as const,
    title: "Wind error +1.2 GW",
    description:
      "Front-weighted revision adds capture risk for CCGT. Peak spark bid if wind backs off.",
    source: "Met ensemble",
    timestamp: "09:30 GMT",
    confidence: "Med",
  },
];

export default function SignalsPage() {
  const [active, setActive] = useState<(typeof filters)[number]>("All");

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
          Physical events with source, confidence, and desk-level readthrough.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {filters.map((f) => {
          const on = active === f;
          return (
            <button
              key={f}
              type="button"
              onClick={() => setActive(f)}
              className={`rounded-[4px] border-[0.5px] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] transition-colors duration-200 ${
                on
                  ? "border-ink bg-ivory-dark text-ink"
                  : "border-ivory-border bg-card text-ink-mid hover:border-ink/25"
              }`}
            >
              {f}
            </button>
          );
        })}
      </div>

      <div className="space-y-3">
        {rows.map((r, i) => (
          <motion.div
            key={r.title}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04, duration: 0.25 }}
          >
            <SignalCard {...r} />
          </motion.div>
        ))}
      </div>
    </div>
  );
}
