"use client";

import { motion } from "framer-motion";
import { Minus, TrendingDown, TrendingUp, type LucideIcon } from "lucide-react";

export type MetricTrend = "up" | "down" | "flat";

export type MetricCardProps = {
  label: string;
  value: string;
  unit?: string;
  trend?: MetricTrend;
  className?: string;
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
}: MetricCardProps) {
  const Icon = trend ? trendIcon[trend] : null;

  return (
    <motion.div
      layout
      className={`rounded-[3px] border-[0.5px] border-ivory-border bg-ivory-dark px-4 py-3 ${className}`}
    >
      <p className="text-[9px] font-medium uppercase tracking-[0.12em] text-ink-mid">
        {label}
      </p>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="font-serif text-2xl font-semibold leading-none tracking-tight text-ink md:text-3xl">
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
    </motion.div>
  );
}
