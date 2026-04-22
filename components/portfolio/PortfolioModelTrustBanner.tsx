"use client";

import type { ReactNode } from "react";

const severityClass: Record<"neutral" | "caution" | "critical", string> = {
  neutral: "border-ivory-border bg-card",
  caution: "border-amber-700/30 bg-amber-50/60",
  critical: "border-[#8B3A3A]/30 bg-[#FDF8F7]",
};

const eyebrowClass: Record<"neutral" | "caution" | "critical", string> = {
  neutral: "text-ink-mid",
  caution: "text-amber-900",
  critical: "text-[#8B3A3A]",
};

const bodyClass: Record<"neutral" | "caution" | "critical", string> = {
  neutral: "text-ink-mid",
  caution: "text-amber-900",
  critical: "text-[#8B3A3A]",
};

export function PortfolioModelTrustBanner({
  eyebrow,
  title,
  children,
  severity = "caution",
  className = "",
}: {
  eyebrow: string;
  title?: string;
  children: ReactNode;
  severity?: "neutral" | "caution" | "critical";
  className?: string;
}) {
  return (
    <div
      className={`rounded-[4px] border-[0.5px] px-4 py-3 ${severityClass[severity]} ${className}`}
      role="status"
    >
      <p
        className={`text-[10px] font-semibold uppercase tracking-[0.14em] ${eyebrowClass[severity]}`}
      >
        {eyebrow}
      </p>
      {title ? (
        <p className={`mt-1 text-sm font-medium ${bodyClass[severity]}`}>{title}</p>
      ) : null}
      <div className={`mt-1 text-sm [&_p+p]:mt-2 ${bodyClass[severity]}`}>
        {children}
      </div>
    </div>
  );
}
