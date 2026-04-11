"use client";

import { ManuscriptMarginalia } from "@/components/ui/ManuscriptMarginalia";
import { motion } from "framer-motion";

export default function BriefPage() {
  return (
    <div className="relative mx-auto max-w-[660px] pl-8 sm:pl-10">
      <div className="pointer-events-none absolute bottom-8 left-0 top-24 hidden sm:block">
        <ManuscriptMarginalia />
      </div>
      <motion.header
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="border-b-[0.5px] border-ivory-border pb-6"
      >
        <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-ink-mid">
          Morning brief · 06:00 GMT
        </p>
        <h1 className="mt-3 font-serif text-4xl text-ink">The session ahead</h1>
        <p className="mt-3 text-sm leading-relaxed text-ink-mid">
          Drivers first, curves second. Sized to your book.
        </p>
      </motion.header>

      <motion.article
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="space-y-6 py-10"
      >
        <section>
          <h2 className="font-serif text-2xl text-ink">Executive summary</h2>
          <p className="mt-3 font-serif text-lg leading-relaxed text-ink">
            Wind-weighted supply runs above the consensus path into the evening
            peak. Prompt gas retains a bid on DES-linked tightness. EU carbon
            Dec is the swing input for coal gas switching on the Continent.
          </p>
        </section>
        <section>
          <h3 className="text-[9px] font-semibold uppercase tracking-[0.16em] text-ink-mid">
            Watch list
          </h3>
          <ul className="mt-3 space-y-2 font-serif text-base leading-relaxed text-ink">
            <li>Nemo flow versus day-ahead spread convergence</li>
            <li>LNG queue at NW Europe, DES window into NBP TTF</li>
            <li>REMIT cluster on GB CCGT, peak spark sensitivity</li>
          </ul>
        </section>
        <section className="rounded-[4px] border-[0.5px] border-ivory-border bg-card px-5 py-4">
          <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-mid">
            Book touchpoints
          </p>
          <p className="mt-2 font-serif text-base leading-relaxed text-ink">
            Baseload length remains long physical premium into the wind error
            band. If REMIT clears on the CCGT cluster, trim peak length before
            wind backs off.
          </p>
        </section>
      </motion.article>
    </div>
  );
}
