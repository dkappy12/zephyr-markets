"use client";

import { motion } from "framer-motion";

export default function RiskPage() {
  return (
    <div className="space-y-8">
      <div>
        <motion.h1
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="font-serif text-3xl text-ink"
        >
          Risk
        </motion.h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-mid">
          VaR, CVaR, and scenario grids stressed on physical shocks, not
          abstract factors alone.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {["VaR (95%)", "CVaR", "Scenario grid"].map((t, i) => (
          <motion.div
            key={t}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="rounded-[3px] border-[0.5px] border-ivory-border bg-ivory-dark px-4 py-4"
          >
            <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-mid">
              {t}
            </p>
            <p className="mt-3 font-serif text-3xl text-ink">n/a</p>
            <p className="mt-2 text-xs text-ink-mid">Awaiting book import</p>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
