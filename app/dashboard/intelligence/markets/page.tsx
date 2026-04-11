"use client";

import { motion } from "framer-motion";

const columns = [
  {
    label: "GB Power",
    value: "Baseload D+1",
    note: "EUA-sensitive stack vs EU carbon Dec",
  },
  { label: "NBP", value: "Day-ahead", note: "DES linkage into marginal LNG" },
  {
    label: "TTF",
    value: "Front month",
    note: "Storage path vs LNG arrivals",
  },
  {
    label: "EU Carbon",
    value: "Dec",
    note: "Power switching and coal gas squeeze",
  },
] as const;

export default function MarketsPage() {
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

      <div className="grid gap-3 md:grid-cols-2">
        {columns.map((c, i) => (
          <motion.div
            key={c.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05, duration: 0.28 }}
            className="rounded-[4px] border-[0.5px] border-ivory-border bg-card px-5 py-4"
          >
            <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-mid">
              {c.label}
            </p>
            <p className="mt-2 font-serif text-2xl text-ink">{c.value}</p>
            <p className="mt-2 text-sm text-ink-mid">{c.note}</p>
          </motion.div>
        ))}
      </div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-[4px] border-[0.5px] border-ivory-border bg-ivory-dark px-5 py-4"
      >
        <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-mid">
          Live tape
        </p>
      </motion.div>
    </div>
  );
}
