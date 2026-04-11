"use client";

import { motion } from "framer-motion";

export default function BookPage() {
  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <motion.h1
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="font-serif text-3xl text-ink"
          >
            Book
          </motion.h1>
          <p className="mt-2 max-w-2xl text-sm text-ink-mid">
            Open positions, curve points, and hedge gaps. This is what physical
            premium and attribution run on.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-[4px] border-[0.5px] border-ivory-border bg-card px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink transition-colors duration-200 hover:bg-ivory-dark"
          >
            Import CSV
          </button>
          <button
            type="button"
            className="rounded-[4px] border-[0.5px] border-ink bg-transparent px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink transition-colors duration-200 hover:bg-ivory-dark/50"
          >
            Quick add
          </button>
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-[4px] border-[0.5px] border-ivory-border bg-card"
      >
        <div className="border-b-[0.5px] border-ivory-border px-5 py-3">
          <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-mid">
            Positions
          </p>
        </div>
        <div className="px-5 py-12 text-center">
          <p className="font-serif text-xl text-ink">No positions imported</p>
          <p className="mt-2 text-sm text-ink-mid">
            Import a file or quick add a line to start book-native scoring.
          </p>
        </div>
      </motion.div>
    </div>
  );
}
