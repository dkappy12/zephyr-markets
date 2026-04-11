"use client";

import { motion } from "framer-motion";

export default function AttributionPage() {
  return (
    <div className="space-y-8">
      <div>
        <motion.h1
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="font-serif text-3xl text-ink"
        >
          Attribution
        </motion.h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-mid">
          P&amp;L decomposed by physical driver. What the market did versus what
          your book captured.
        </p>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex min-h-[200px] items-center justify-center rounded-[4px] border-[0.5px] border-ivory-border bg-card px-5 py-10"
      >
        <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-mid">
          P&amp;L by driver
        </p>
      </motion.div>
    </div>
  );
}
