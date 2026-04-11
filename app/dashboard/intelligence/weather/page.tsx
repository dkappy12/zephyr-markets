"use client";

import { WindRose } from "@/components/ui/WindRose";
import { motion } from "framer-motion";

export default function WeatherPage() {
  return (
    <div className="space-y-8">
      <div>
        <motion.h1
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="font-serif text-3xl text-ink"
        >
          Weather
        </motion.h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-mid">
          Ensemble wind, temperature, and precipitation drivers with error
          bands tied to your GB and NW Europe power exposures.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="relative min-h-[320px] rounded-[4px] border-[0.5px] border-ivory-border bg-card"
        >
          <div className="absolute right-4 top-4">
            <WindRose size={96} />
          </div>
          <div className="absolute bottom-4 left-4">
            <span className="font-sans text-[9px] font-medium uppercase tracking-[0.14em] text-ink-light">
              Wind forecast
            </span>
          </div>
        </motion.div>
        <aside className="space-y-3">
          <div className="rounded-[4px] border-[0.5px] border-ivory-border bg-ivory-dark px-4 py-3">
            <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-mid">
              Wind surprise (24h)
            </p>
            <p className="mt-2 font-serif text-3xl text-ink">+1.2 GW</p>
            <p className="mt-1 text-xs text-ink-mid">vs prior run</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
