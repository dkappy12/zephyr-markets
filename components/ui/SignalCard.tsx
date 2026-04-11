"use client";

import { motion } from "framer-motion";
import {
  Activity,
  AlertTriangle,
  Anchor,
  Cloud,
  Gauge,
  type LucideIcon,
} from "lucide-react";
import { TriangulationMesh } from "@/components/ui/TriangulationMesh";

export type SignalBorderTone = "bull" | "bear" | "watch" | "neutral";

export type SignalCardProps = {
  tone: SignalBorderTone;
  type?: "flow" | "weather" | "lng" | "alert" | "generic";
  title: string;
  description: string;
  source?: string;
  timestamp: string;
  confidence?: string;
  pnlImpact?: string;
  className?: string;
};

const borderClass: Record<SignalBorderTone, string> = {
  bull: "border-l-bull",
  bear: "border-l-bear",
  watch: "border-l-watch",
  neutral: "border-l-ink-light",
};

const typeIcon: Record<NonNullable<SignalCardProps["type"]>, LucideIcon> = {
  flow: Gauge,
  weather: Cloud,
  lng: Anchor,
  alert: AlertTriangle,
  generic: Activity,
};

export function SignalCard({
  tone,
  type = "generic",
  title,
  description,
  source,
  timestamp,
  confidence,
  pnlImpact,
  className = "",
}: SignalCardProps) {
  const Icon = typeIcon[type];

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className={`relative overflow-hidden rounded-[4px] border-[0.5px] border-ivory-border border-l-[2px] bg-card px-4 py-3 ${borderClass[tone]} ${className}`}
    >
      <div
        className="pointer-events-none absolute right-0 top-0 z-0 h-[96px] w-[72px] overflow-visible"
        aria-hidden
      >
        <TriangulationMesh
          className="block h-full w-full"
          width={72}
          height={96}
          opacity={0.08}
          strokeWidth={1}
        />
      </div>
      <div className="relative z-[1] flex items-start gap-3">
        <span className="mt-0.5 text-ink-mid" aria-hidden>
          <Icon className="size-4" strokeWidth={1.5} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-sans text-sm font-semibold leading-snug text-ink">
              {title}
            </h3>
            {confidence ? (
              <span className="rounded-[2px] border-[0.5px] border-ivory-border bg-ivory px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.1em] text-ink-mid">
                {confidence}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-sm leading-relaxed text-ink-mid">
            {description}
          </p>
          {pnlImpact ? (
            <p className="mt-2 font-sans text-xs tabular-nums text-ink">
              {pnlImpact}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-light">
            {source ? <span>{source}</span> : null}
            <span className="uppercase tracking-wide">{timestamp}</span>
          </div>
        </div>
      </div>
    </motion.article>
  );
}
