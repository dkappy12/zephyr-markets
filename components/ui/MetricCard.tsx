"use client";

import { motion } from "framer-motion";
import { Minus, TrendingDown, TrendingUp, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export type MetricTrend = "up" | "down" | "flat";

export type MetricCardProps = {
  label: string;
  value: string;
  unit?: string;
  trend?: MetricTrend;
  className?: string;
  /** One line under the value (e.g. as-of / source). */
  footnote?: ReactNode;
  /** Extra panel shown on hover (e.g. multi-country breakdown). */
  hoverDetail?: ReactNode;
  /** Override default value typography (e.g. placeholder styling). */
  valueClassName?: string;
};

const trendIcon: Record<MetricTrend, LucideIcon> = {
  up: TrendingUp,
  down: TrendingDown,
  flat: Minus,
};

export function MetricCard({
  label,
  value,
  unit,
  trend,
  className = "",
  footnote,
  hoverDetail,
  valueClassName,
}: MetricCardProps) {
  const Icon = trend ? trendIcon[trend] : null;

  return (
    <motion.div
      layout
      className={`rounded-[3px] border-[0.5px] border-ivory-border bg-ivory-dark px-4 py-3 ${hoverDetail ? "group relative" : ""} ${className}`}
    >
      <p className="text-[9px] font-medium uppercase tracking-[0.12em] text-ink-mid">
        {label}
      </p>
      <div className="mt-1 flex items-baseline gap-2">
        <span
          className={
            valueClassName ??
            "font-serif text-2xl font-semibold leading-none tracking-tight text-ink md:text-3xl"
          }
        >
          {value}
        </span>
        {unit ? (
          <span className="text-sm font-medium text-ink-mid">{unit}</span>
        ) : null}
        {Icon && trend ? (
          <span
            className={
              trend === "up"
                ? "text-bull"
                : trend === "down"
                  ? "text-bear"
                  : "text-ink-light"
            }
            aria-hidden
          >
            <Icon className="size-4" strokeWidth={1.75} />
          </span>
        ) : null}
      </div>
      {footnote ? (
        <p className="mt-1.5 text-[10px] leading-snug text-ink-light">{footnote}</p>
      ) : null}
      {hoverDetail ? (
        <div
          className="pointer-events-none invisible absolute left-0 top-full z-30 mt-2 min-w-[220px] rounded-[3px] border-[0.5px] border-ivory-border bg-card px-3 py-2 text-left text-[11px] leading-snug text-ink shadow-sm opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:visible group-hover:opacity-100"
          role="tooltip"
        >
          {hoverDetail}
        </div>
      ) : null}
    </motion.div>
  );
}
