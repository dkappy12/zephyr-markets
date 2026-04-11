"use client";

import { motion } from "framer-motion";
import Link from "next/link";

export type UpgradePromptProps = {
  featureName: string;
  description: string;
  href?: string;
  ctaLabel?: string;
  className?: string;
};

export function UpgradePrompt({
  featureName,
  description,
  href = "/#pricing",
  ctaLabel = "Upgrade to Pro",
  className = "",
}: UpgradePromptProps) {
  return (
    <motion.div
      role="status"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      className={`rounded-[4px] border-[0.5px] border-gold/50 bg-card px-5 py-4 ${className}`}
    >
      <p className="font-serif text-lg text-ink">{featureName}</p>
      <p className="mt-1 max-w-prose text-sm leading-relaxed text-ink-mid">
        {description}
      </p>
      <Link
        href={href}
        className="mt-4 inline-flex items-center justify-center rounded-[4px] bg-gold px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-ivory transition-colors duration-200 hover:bg-[#7a5f1a]"
      >
        {ctaLabel}
      </Link>
    </motion.div>
  );
}
