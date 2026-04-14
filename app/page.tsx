"use client";

import { createClient } from "@/lib/supabase/client";
import { TopoBackground } from "@/components/ui/TopoBackground";
import { TriangulationMesh } from "@/components/ui/TriangulationMesh";
import { motion } from "framer-motion";
import Link from "next/link";
import { useEffect, useState } from "react";

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: {
      delay: i * 0.15,
      duration: 0.5,
      ease: [0.22, 1, 0.36, 1] as const,
    },
  }),
};

const briefSectionLabel =
  "text-[9px] font-semibold uppercase tracking-[0.16em] text-ink-light";
const bookTouchpointsLabel =
  "text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-light";

const PLAN_COMPARISON_ROWS: {
  feature: string;
  free: string;
  pro: string;
  team: string;
}[] = [
  { feature: "Price", free: "£0", pro: "£39/month", team: "£149/month" },
  { feature: "Seats", free: "1", pro: "1", team: "5" },
  {
    feature: "Signal feed",
    free: "Delayed 2h",
    pro: "Real-time",
    team: "Real-time",
  },
  {
    feature: "Physical premium score",
    free: "✓",
    pro: "✓",
    team: "✓",
  },
  {
    feature: "REMIT alerts",
    free: "Delayed 2h",
    pro: "Real-time",
    team: "Real-time",
  },
  {
    feature: "Morning brief",
    free: "08:00 delayed",
    pro: "06:00 live",
    team: "06:00 live per seat",
  },
  {
    feature: "Markets covered",
    free: "GB Power, NBP",
    pro: "5 markets",
    team: "All markets",
  },
  {
    feature: "Portfolio positions",
    free: "-",
    pro: "30 positions",
    team: "Unlimited",
  },
  {
    feature: "Signal history",
    free: "7 days",
    pro: "6 months",
    team: "24 months",
  },
  {
    feature: "API access",
    free: "-",
    pro: "-",
    team: "Full REST API",
  },
  {
    feature: "Data export",
    free: "-",
    pro: "-",
    team: "✓",
  },
  {
    feature: "Team management",
    free: "-",
    pro: "-",
    team: "Admin + invitations",
  },
  {
    feature: "Support",
    free: "Community",
    pro: "Email",
    team: "Priority email",
  },
];

function LiveTicker() {
  const [items, setItems] = useState<string[]>([]);

  useEffect(() => {
    async function fetchTickerData() {
      const supabase = createClient();

      // Fetch latest physical premium
      const { data: premium } = await supabase
        .from("physical_premium")
        .select(
          "normalised_score, direction, implied_price_gbp_mwh, market_price_gbp_mwh, wind_gw, solar_gw, residual_demand_gw, regime",
        )
        .order("calculated_at", { ascending: false })
        .limit(1)
        .single();

      // Fetch latest N2EX price
      const { data: n2ex } = await supabase
        .from("market_prices")
        .select("price_gbp_mwh, price_time")
        .eq("market", "N2EX")
        .order("price_time", { ascending: false })
        .limit(1)
        .single();

      // Fetch latest TTF price
      const { data: ttf } = await supabase
        .from("gas_prices")
        .select("price_eur_mwh, price_time")
        .eq("hub", "TTF")
        .order("price_time", { ascending: false })
        .limit(1)
        .single();

      // Fetch latest NBP price
      const { data: nbp } = await supabase
        .from("gas_prices")
        .select("price_eur_mwh, price_time")
        .eq("hub", "NBP")
        .order("price_time", { ascending: false })
        .limit(1)
        .single();

      // Fetch EU storage (Germany as proxy)
      const { data: storage } = await supabase
        .from("storage_levels")
        .select("full_pct, country_code")
        .in("country_code", ["DE", "FR", "NL", "IT"])
        .order("recorded_at", { ascending: false })
        .limit(4);

      // Fetch recent REMIT signal count
      const { count: signalCount } = await supabase
        .from("signals")
        .select("*", { count: "exact", head: true })
        .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

      // Build ticker items from live data
      const built: string[] = [];

      if (premium) {
        const sign = (premium.normalised_score ?? 0) >= 0 ? "+" : "";
        built.push(
          `PHYSICAL PREMIUM · ${sign}${premium.normalised_score?.toFixed(1)} ${premium.direction}`,
        );
        if (premium.implied_price_gbp_mwh)
          built.push(
            `IMPLIED PRICE · £${Number(premium.implied_price_gbp_mwh).toFixed(2)}/MWH`,
          );
        if (premium.wind_gw)
          built.push(`GB WIND · ${Number(premium.wind_gw).toFixed(1)} GW`);
        if (premium.solar_gw != null)
          built.push(`GB SOLAR · ${Number(premium.solar_gw).toFixed(1)} GW`);
        if (premium.residual_demand_gw)
          built.push(
            `RESIDUAL DEMAND · ${Number(premium.residual_demand_gw).toFixed(1)} GW`,
          );
        if (premium.regime)
          built.push(
            `REGIME · ${premium.regime.toUpperCase().replace("-", " ")}`,
          );
      }

      if (n2ex?.price_gbp_mwh) {
        built.push(`GB DAY-AHEAD · £${Number(n2ex.price_gbp_mwh).toFixed(2)}/MWH`);
      }

      if (ttf?.price_eur_mwh) {
        built.push(`TTF · €${Number(ttf.price_eur_mwh).toFixed(2)}/MWH`);
      }

      if (nbp?.price_eur_mwh) {
        built.push(`NBP · ${Number(nbp.price_eur_mwh).toFixed(2)} P/THERM`);
      }

      if (storage && storage.length > 0) {
        storage.forEach((s) => {
          if (s.full_pct) {
            built.push(
              `${s.country_code} GAS STORAGE · ${Number(s.full_pct).toFixed(1)}% FULL`,
            );
          }
        });
      }

      if (signalCount != null) {
        built.push(`REMIT SIGNALS 24H · ${signalCount}`);
      }

      // Fallback if fetch fails or returns empty
      if (built.length === 0) {
        built.push(
          "PHYSICAL PREMIUM · LIVE",
          "GB DAY-AHEAD · N2EX",
          "TTF · EEX NGP",
          "NBP · ICE",
          "REMIT · LIVE FEED",
          "WIND · OPEN-METEO",
          "SOLAR · PV LIVE",
          "EU STORAGE · GIE AGSI",
        );
      }

      setItems(built);
    }

    fetchTickerData();
    // Refresh every 5 minutes
    const interval = setInterval(fetchTickerData, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // Don't render until we have data (avoids flash of empty ticker)
  if (items.length === 0) return null;

  // Repeat items enough times to guarantee full width coverage regardless of screen size
  const repeated = [...items, ...items, ...items, ...items];

  return (
    <div className="border-b-[0.5px] border-ivory-border bg-ink text-ivory">
      <div className="relative overflow-hidden py-2">
        <div className="animate-ticker-marquee flex w-max gap-12 whitespace-nowrap font-sans text-[9px] font-medium uppercase tracking-[0.2em] text-ivory/90">
          {repeated.map((line, i) => (
            <span key={`${line}-${i}`}>{line}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const [showComparison, setShowComparison] = useState(false);

  return (
    <div className="flex min-h-screen flex-col bg-ivory">
      <nav className="sticky top-0 z-50 border-b-[0.5px] border-ivory-border bg-ivory/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-[1100px] items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <Link href="/" className="font-serif text-xl text-ink">
            Zephyr
          </Link>
          <div className="flex items-center gap-6">
            <Link
              href="/login"
              className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-mid transition-colors hover:text-ink"
            >
              Log in
            </Link>
            <Link
              href="/signup"
              className="inline-flex h-8 items-center rounded-[4px] bg-ink px-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-ivory transition-colors hover:bg-[#1f1d1a]"
            >
              Start free
            </Link>
          </div>
        </div>
      </nav>
      <section className="relative overflow-hidden border-b-[0.5px] border-ivory-border">
        <div className="pointer-events-none absolute inset-0 z-0 min-h-[560px]">
          <TopoBackground className="h-full w-full min-h-[560px]" lineOpacity={0.25} />
        </div>
        <div className="pointer-events-none absolute bottom-0 right-0 z-[1] opacity-[0.14] sm:opacity-[0.18]">
          <TriangulationMesh width={280} height={360} opacity={0.22} strokeWidth={0.9} />
        </div>
        <div className="relative z-10 mx-auto max-w-[1100px] px-4 pb-16 pt-[100px] sm:px-6 sm:pb-24 sm:pt-[112px] lg:px-8">
          <div className="mx-auto max-w-3xl text-center">
            <motion.h1
              custom={0}
              variants={fadeUp}
              initial="hidden"
              animate="show"
              className="font-serif text-[2.125rem] font-medium leading-[1.1] tracking-tight text-ink sm:text-5xl lg:text-[3.15rem]"
            >
              The physical world, translated into financial intelligence.
            </motion.h1>
            <motion.p
              custom={1}
              variants={fadeUp}
              initial="hidden"
              animate="show"
              className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-ink-mid sm:text-lg"
            >
              Live REMIT signals, a CCGT-anchored premium score, and a 06:00 brief,
              sized to your book.
            </motion.p>
          </div>

          <motion.div
            custom={2}
            variants={fadeUp}
            initial="hidden"
            animate="show"
            className="mx-auto mt-12 max-w-lg"
          >
            <div className="rounded-[4px] border-[0.5px] border-ivory-border bg-card p-5 text-ink shadow-sm sm:p-6">
              <div className="flex items-start justify-between gap-3 border-b border-ink/10 pb-4">
                <div className="flex items-center gap-2">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full bg-bull animate-live-dot-pulse"
                    aria-hidden
                  />
                  <span className="font-sans text-[9px] font-semibold uppercase tracking-[0.2em] text-ink-mid">
                    Physical premium score
                  </span>
                </div>
                <span className="font-mono text-[10px] tabular-nums tracking-wide text-ink-mid">
                  06:42 GMT
                </span>
              </div>
              <div className="mt-6 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <span className="font-serif text-5xl font-medium leading-none tracking-tight text-ink sm:text-[3.25rem]">
                  +4.8
                </span>
                <span className="font-sans text-xs font-semibold uppercase tracking-[0.18em] text-gold">
                  Firming
                </span>
              </div>
              <div className="mt-6 space-y-2 font-mono text-[11px] leading-relaxed tabular-nums text-ink-mid sm:text-xs">
                <p>
                  Implied £118.40 <span className="text-ink-light">·</span> N2EX £101.12
                </p>
                <p>
                  SRMC £89.50 <span className="text-ink-light">·</span> Wind 8.2 GW
                </p>
              </div>
              <div className="mt-5 border-t border-ink/10 pt-4 font-mono text-[10px] leading-relaxed text-ink-mid sm:text-[11px]">
                <p>3,240 MW unplanned REMIT active</p>
                <p className="mt-1.5 text-ink-light">
                  Regime: transitional → gas-dominated
                </p>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      <LiveTicker />

      <section className="border-b-[0.5px] border-ivory-border py-16 sm:py-24">
        <div className="mx-auto max-w-[1100px] px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ duration: 0.45 }}
          >
            <h2 className="font-serif text-3xl text-ink sm:text-[2rem]">
              Every REMIT notice, scored in plain English.
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-mid">
              The same feed you get in-product. Every notice scored, sized, and
              explained in plain English.
            </p>
          </motion.div>
          <div className="mt-10 grid gap-5 lg:grid-cols-3">
            <LandingSignalCard
              meta="UNPLANNED · HIGH · 645 MW"
              title="T_DRAXX-4 · Drax Power Station Unit 4"
              detail="Unavailable from 13 Apr 06:00 - return unknown"
              implication="645 MW of baseload removed without notice. Tightens residual demand by ~1.5 GW when wind drops below 8 GW. Watch GB Power front-month."
              severity="high"
              assetLabel="Other"
            />
            <LandingSignalCard
              meta="PLANNED · MEDIUM · 920 MW"
              title="T_MRWD-1 · Mereworth Gas Turbine"
              detail="Maintenance outage 14-22 Apr"
              implication="Scheduled peaker maintenance. Market has priced this - no immediate action unless unplanned extension."
              severity="medium"
              assetLabel="CCGT"
            />
            <LandingSignalCard
              meta="INTERCONNECTOR · HIGH · 1,000 MW"
              title="IFA1 · France-GB Interconnector"
              detail="Reduced capacity from 2,000 MW to 1,000 MW"
              implication="Half of IFA1 flow removed. With French nuclear at 72% availability, this reduces import optionality during peak demand periods."
              severity="high"
              accent="interconnector"
              assetLabel="Interconnector"
            />
          </div>
        </div>
      </section>

      <section className="border-b-[0.5px] border-ivory-border bg-ivory-dark py-24 sm:py-32">
        <div className="mx-auto max-w-[1100px] px-4 sm:px-6 lg:px-8">
          <h2 className="text-center font-serif text-3xl text-ink sm:text-4xl">
            Every move in your book, explained.
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-sm text-ink-mid">
            Zephyr decomposes intraday P&amp;L into the physical drivers that caused
            it. Wind, gas, REMIT, carbon - each attributed separately.
          </p>
          <div className="mx-auto mt-12 max-w-3xl rounded-[4px] bg-card p-8 text-ink">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-light">
              Long 50 MW · GB Power Q3 2026 Baseload
            </p>
            <div className="mt-2 flex items-baseline gap-4">
              <span className="font-serif text-3xl text-ink">+£29,310</span>
              <span className="font-mono text-[11px] text-ink-light">Session P&amp;L</span>
            </div>
            <p className="mt-1 font-mono text-[10px] text-ink-light">
              Entry £89.50/MWh · Current £101.12/MWh
            </p>
            <div className="mb-6 mt-6 border-t border-ink/10" />
            <p className="mb-4 font-sans text-[9px] font-semibold uppercase tracking-[0.16em] text-ink-light">
              Today&apos;s Attribution
            </p>
            <AttributionDriverRows />
            <div className="border-t border-ink/10 pt-4">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] text-ink-light">Session P&amp;L</span>
                <span className="font-serif text-xl text-ink">+£29,310</span>
              </div>
            </div>
          </div>
          <div className="mt-6 max-w-3xl mx-auto grid grid-cols-2 gap-px rounded-[4px] border-[0.5px] border-ivory-border bg-ivory-border overflow-hidden">
            <div className="bg-card p-6">
              <p className="font-sans text-[9px] font-semibold uppercase tracking-[0.16em] text-ink-light">
                Wind attribution
              </p>
              <p className="mt-2 font-serif text-4xl text-ink">+£14,200</p>
              <p className="mt-1 font-sans text-[10px] uppercase tracking-[0.1em] text-bull">
                +£14.20/MWh price suppression benefit
              </p>
              <p className="mt-3 text-sm leading-relaxed text-ink-mid">
                Wind at 8.2 GW sits 4.1 GW above the 7-day baseline, suppressing GB
                day-ahead prices and directly benefiting the long power position.
              </p>
            </div>
            <div className="bg-card p-6">
              <p className="font-sans text-[9px] font-semibold uppercase tracking-[0.16em] text-ink-light">
                REMIT attribution
              </p>
              <p className="mt-2 font-serif text-4xl text-ink">+£4,800</p>
              <p className="mt-1 font-sans text-[10px] uppercase tracking-[0.1em] text-bull">
                +£4.80/MWh unplanned outage uplift
              </p>
              <p className="mt-3 text-sm leading-relaxed text-ink-mid">
                3,240 MW of unplanned outages active, 1,840 MW above the planned
                baseline. Tighter-than-expected supply adds uplift to the long position.
              </p>
            </div>
          </div>
          <p className="mt-6 text-center text-sm text-ink-mid">
            Attribution updates every 5 minutes as physical conditions change.
          </p>
        </div>
      </section>

      <section className="border-b-[0.5px] border-ivory-border bg-card/80 py-16 sm:py-24">
        <div className="mx-auto max-w-[720px] px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ duration: 0.45 }}
            className="text-center"
          >
            <h2 className="font-serif text-3xl text-ink sm:text-[2rem]">
              The session ahead. In your inbox by 06:00.
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-ink-mid">
              Published at 06:00 GMT every trading day, personalised to your open
              positions.
            </p>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ duration: 0.45, delay: 0.05 }}
            className="mt-10 rounded-[4px] border-[0.5px] border-ivory-border bg-ivory px-6 py-8 sm:px-8"
          >
            <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-ink-mid">
              Morning brief · 06:00 GMT
            </p>
            <div className="mt-8 space-y-8">
              <section>
                <h3 className={briefSectionLabel}>Overnight summary</h3>
                <p className="mt-3 font-serif text-lg leading-relaxed text-ink">
                  Physical premium model shows moderate firming with a normalised
                  score of +4.8, as market prices at £101.12/MWh sit £17.28/MWh
                  below the physically-implied £118.40/MWh. Wind generation at 8.2
                  GW with solar adding 1.1 GW drives residual demand to 22.4 GW.
                  Key overnight REMIT signal: Drax Unit 4&apos;s unplanned 645 MW
                  outage continuing through multiple periods.
                </p>
              </section>
              <section>
                <p className={bookTouchpointsLabel}>BOOK TOUCHPOINTS</p>
                <p className="mt-3 font-serif text-lg leading-relaxed text-ink">
                  The long 50 MW GB Power Q3 2026 Baseload entered at £89.50 is
                  well-supported - today&apos;s physical conditions suggest the
                  market is underpricing tightness risk by £17/MWh. The short
                  25,000 therm NBP Winter 2026 is correctly positioned given
                  temperature-suppressed demand; TTF at €50/MWh with weak heating
                  load supports the bias.
                </p>
              </section>
            </div>
          </motion.div>
        </div>
      </section>

      <section className="border-b-[0.5px] border-ivory-border py-14 sm:py-20">
        <div className="mx-auto max-w-[1100px] px-4 sm:px-6 lg:px-8">
          <div className="grid gap-10 sm:grid-cols-3 sm:gap-6">
            <ProductStat
              value="Every 5 min"
              label="SRMC model recalculated against live TTF, wind and REMIT"
            />
            <ProductStat
              value="60 sec"
              label="REMIT notice to scored signal in your feed"
            />
            <ProductStat
              value="8 sources"
              label="Elexon, EEX, PV_Live, GIE AGSI, Nord Pool, Open-Meteo and more"
            />
          </div>
        </div>
      </section>

      <section id="pricing" className="py-16 sm:py-20">
        <div className="mx-auto max-w-[1100px] px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-xl text-center">
            <h2 className="font-serif text-3xl text-ink sm:text-4xl">Pricing</h2>
            <p className="mt-3 text-sm leading-relaxed text-ink-mid">
              Start on delayed data. Upgrade when you need real time and the full
              market set.
            </p>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            <PricingCard
              name="Free"
              price="£0"
              blurb="Physical premium score, morning brief (06:00 UTC), and signal feed. No credit card required."
              cta="Start free"
              href="/signup"
              emphasis={false}
            />
            <PricingCard
              name="Pro"
              price="£39"
              period="/month"
              blurb="Live signals, 06:00 brief, five markets, portfolio tools."
              cta="Get Pro"
              href="/signup?plan=pro"
              emphasis
              footnote="Reserve your place."
            />
            <PricingCard
              name="Team"
              price="£149"
              period="/month"
              blurb="Five seats, unlimited positions, API access, all markets."
              cta="Get Team"
              href="/signup?plan=team"
              emphasis={false}
              footnote="Reserve your place."
            />
          </div>
          <p className="mt-10 text-center text-sm text-ink-light">
            Need more than 5 seats?{" "}
            <a
              href="mailto:contact@zephyr.markets"
              className="text-ink-mid underline decoration-ivory-border underline-offset-2 transition-colors hover:text-ink"
            >
              contact@zephyr.markets
            </a>
          </p>
        </div>
      </section>

      <section
        aria-labelledby="plan-comparison-heading"
        className="border-b-[0.5px] border-ivory-border bg-ivory py-16 sm:py-20"
      >
        <div className="mx-auto max-w-[1100px] px-4 sm:px-6 lg:px-8">
          <h2
            id="plan-comparison-heading"
            className="text-center font-serif text-3xl text-ink sm:text-4xl"
          >
            Everything in the plan
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-sm leading-relaxed text-ink-mid">
            Compare tiers at a glance. Upgrade when you need real time, depth, or a
            full desk on one book.
          </p>
          <button
            type="button"
            onClick={() => setShowComparison(!showComparison)}
            className="mx-auto mt-8 flex w-max items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-mid transition-colors hover:text-ink"
          >
            {showComparison ? "Hide feature comparison" : "Compare all features"}
            <span className="text-xs">{showComparison ? "↑" : "↓"}</span>
          </button>
          {showComparison ? (
            <div className="mt-6 overflow-x-auto rounded-[4px] border-[0.5px] border-ivory-border bg-card shadow-sm">
              <table className="w-full min-w-[640px] border-collapse text-left">
                <thead>
                  <tr className="border-b-[0.5px] border-ivory-border">
                    <th
                      scope="col"
                      className="sticky left-0 z-[1] bg-card px-4 py-4 text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-mid"
                    >
                      Feature
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-4 text-center font-serif text-lg font-medium text-ink"
                    >
                      Free
                    </th>
                    <th
                      scope="col"
                      className="border-x border-gold/45 bg-ivory-dark/50 px-4 py-4 text-center font-serif text-lg font-medium text-ink"
                    >
                      Pro
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-4 text-center font-serif text-lg font-medium text-ink"
                    >
                      Team
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {PLAN_COMPARISON_ROWS.map((row) => (
                    <tr
                      key={row.feature}
                      className="border-b-[0.5px] border-ivory-border last:border-b-0"
                    >
                      <th
                        scope="row"
                        className="sticky left-0 z-[1] bg-card px-4 py-3 text-sm font-medium text-ink"
                      >
                        {row.feature}
                      </th>
                      <PlanComparisonCell value={row.free} />
                      <PlanComparisonCell value={row.pro} highlight />
                      <PlanComparisonCell value={row.team} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </section>

      <footer className="border-t-[0.5px] border-ivory-border py-10">
        <div className="mx-auto flex max-w-[1100px] flex-col items-center justify-center gap-3 px-4 text-center sm:px-6 lg:px-8">
          <p className="text-xs text-ink-mid">
            Zephyr Markets © 2026 ·{" "}
            <a
              href="mailto:contact@zephyr.markets"
              className="text-ink-mid underline decoration-ivory-border underline-offset-2 transition-colors hover:text-ink"
            >
              contact@zephyr.markets
            </a>
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
            <Link
              href="/privacy"
              className="text-xs font-medium uppercase tracking-[0.12em] text-ink-mid transition-colors hover:text-ink"
            >
              Privacy
            </Link>
            <Link
              href="/terms"
              className="text-xs font-medium uppercase tracking-[0.12em] text-ink-mid transition-colors hover:text-ink"
            >
              Terms
            </Link>
            <Link
              href="/login"
              className="text-xs font-medium uppercase tracking-[0.12em] text-ink-mid transition-colors hover:text-ink"
            >
              Log in
            </Link>
            <Link
              href="/signup"
              className="text-xs font-medium uppercase tracking-[0.12em] text-ink-mid transition-colors hover:text-ink"
            >
              Sign up
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

function AttributionDriverRows() {
  const rows: {
    name: string;
    amount: string;
    pct: number;
    positive: boolean;
  }[] = [
    { name: "Wind delta", amount: "+£14,200", pct: 100, positive: true },
    { name: "Residual", amount: "+£3,450", pct: 24, positive: true },
    { name: "Shape/demand", amount: "+£2,180", pct: 15, positive: true },
    { name: "REMIT shift", amount: "+£4,800", pct: 34, positive: true },
    { name: "Gas (TTF move)", amount: "-£3,600", pct: 25, positive: false },
    { name: "Carbon", amount: "-£1,720", pct: 12, positive: false },
  ];

  return (
    <>
      {rows.map((row, i) => (
        <div key={row.name}>
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-mono text-[11px] text-ink-mid">{row.name}</span>
            <span
              className={`font-mono text-[11px] tabular-nums ${
                row.positive ? "text-bull" : "text-[#8B3A3A]"
              }`}
            >
              {row.amount}
            </span>
          </div>
          <div className="mb-3 mt-1 h-1 w-full overflow-hidden rounded-full bg-ink/10">
            <motion.div
              className={`h-full rounded-full ${
                row.positive ? "bg-bull/60" : "bg-[#c47a7a]/40"
              }`}
              initial={{ width: "0%" }}
              whileInView={{ width: `${row.pct}%` }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: i * 0.08 }}
            />
          </div>
        </div>
      ))}
    </>
  );
}

function LandingSignalCard({
  meta,
  title,
  detail,
  implication,
  severity,
  accent,
  assetLabel,
}: {
  meta: string;
  title: string;
  detail: string;
  implication: string;
  severity: "high" | "medium";
  accent?: "interconnector";
  assetLabel: string;
}) {
  const severityClass =
    severity === "high"
      ? "border-transparent bg-[#8B3A3A] text-white"
      : "border-transparent bg-[#92400E] text-white";
  const accentClass =
    accent === "interconnector"
      ? "border-cyan-700/30 bg-cyan-50/80 text-cyan-950"
      : assetLabel === "CCGT"
        ? "border-amber-700/35 bg-amber-50/80 text-amber-900"
        : "border-ivory-border bg-ivory text-ink-mid";

  return (
    <article className="rounded-[4px] border-[0.5px] border-ivory-border bg-card px-4 py-4">
      <p className="font-sans text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-mid">
        {meta}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span
          className={`rounded-[3px] border-[0.5px] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] ${accentClass}`}
        >
          {assetLabel}
        </span>
        <span
          className={`rounded-[3px] border-[0.5px] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] ${severityClass}`}
        >
          {severity === "high" ? "HIGH" : "MEDIUM"}
        </span>
      </div>
      <h3 className="mt-3 font-sans text-base font-semibold leading-snug text-ink">
        {title}
      </h3>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-mid">{detail}</p>
      <p className="mt-4 border-t border-ivory-border pt-3 font-serif text-[15px] italic leading-relaxed text-ink">
        {implication}
      </p>
    </article>
  );
}

function ProductStat({ value, label }: { value: string; label: string }) {
  return (
    <div className="text-center sm:text-left">
      <p className="font-serif text-4xl tracking-tight text-ink sm:text-[2.75rem]">
        {value}
      </p>
      <p className="mt-2 text-sm leading-snug text-ink-mid">{label}</p>
    </div>
  );
}

function PricingCard({
  name,
  price,
  period,
  blurb,
  cta,
  href,
  emphasis,
  footnote,
}: {
  name: string;
  price: string;
  period?: string;
  blurb: string;
  cta: string;
  href: string;
  emphasis?: boolean;
  footnote?: string;
}) {
  return (
    <div
      className={`rounded-[4px] border-[0.5px] bg-card px-6 py-7 ${
        emphasis ? "border-gold/55" : "border-ivory-border"
      }`}
    >
      <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-ink-mid">
        {name}
      </p>
      <p className="mt-4 font-serif text-4xl text-ink">
        {price}
        {period ? (
          <span className="ml-1 font-sans text-sm font-medium text-ink-mid">
            {period}
          </span>
        ) : null}
      </p>
      <p className="mt-4 text-sm leading-relaxed text-ink-mid">{blurb}</p>
      <Link
        href={href}
        className={`mt-8 inline-flex h-10 w-full items-center justify-center rounded-[4px] text-xs font-semibold tracking-[0.08em] transition-colors duration-200 ${
          emphasis
            ? "bg-gold text-ivory hover:bg-[#7a5f1a]"
            : "border-[0.5px] border-ivory-border bg-ivory text-ink hover:bg-ivory-dark"
        }`}
      >
        {cta}
      </Link>
      {footnote ? (
        <p className="mt-3 text-center text-[10px] leading-snug text-ink-light">
          {footnote}
        </p>
      ) : null}
    </div>
  );
}

function PlanComparisonCell({
  value,
  highlight,
}: {
  value: string;
  highlight?: boolean;
}) {
  const isCheck = value === "✓";
  const isDash = value === "-";
  return (
    <td
      className={`px-4 py-3 text-center align-middle text-sm ${
        highlight ? "border-x border-gold/45 bg-ivory-dark/50" : ""
      } ${
        isCheck
          ? "font-medium text-bull"
          : isDash
            ? "text-ink-light"
            : "text-ink-mid"
      }`}
    >
      {value}
    </td>
  );
}
