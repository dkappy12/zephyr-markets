"use client";

import { motion } from "framer-motion";

const recs = [
  {
    title: "Hedge NBP prompt with TTF spread guard",
    detail:
      "Cuts DES-sensitive tail on the gas book while keeping spark optionality.",
  },
  {
    title: "Trim peak length against wind error band",
    detail: "Aligns with +1.2 GW surprise into evening peak on GB Power.",
  },
  {
    title: "Add EUA overlay on CCGT stack",
    detail: "Brings carbon switching in line with observed spark.",
  },
] as const;

export default function OptimisePage() {
  return (
    <div className="space-y-8">
      <div>
        <motion.h1
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="font-serif text-3xl text-ink"
        >
          Optimise
        </motion.h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-mid">
          Three hedge recommendations tied to named physical drivers. Auditable
          and book-specific.
        </p>
      </div>

      <ol className="space-y-3">
        {recs.map((r, i) => (
          <motion.li
            key={r.title}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06 }}
            className="rounded-[4px] border-[0.5px] border-ivory-border bg-card px-5 py-4"
          >
            <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-mid">
              Recommendation {i + 1}
            </p>
            <p className="mt-2 font-serif text-xl text-ink">{r.title}</p>
            <p className="mt-2 text-sm text-ink-mid">{r.detail}</p>
          </motion.li>
        ))}
      </ol>
    </div>
  );
}
