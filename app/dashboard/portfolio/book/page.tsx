"use client";

import { TierGate } from "@/components/billing/TierGate";
import { BookPageClient } from "@/components/portfolio/BookPageClient";
import { useEffect, useState } from "react";

export default function BookPage() {
  const [currentTier, setCurrentTier] = useState<"free" | "pro" | "team" | null>(null);

  useEffect(() => {
    fetch("/api/billing/status")
      .then((r) => r.json())
      .then((body: { effectiveTier?: string }) => {
        const t = body.effectiveTier;
        setCurrentTier(t === "pro" || t === "team" ? t : "free");
      })
      .catch(() => setCurrentTier("free"));
  }, []);

  return (
    <TierGate
      requiredTier="pro"
      currentTier={currentTier}
      featureName="Portfolio Book"
      description="Track positions, P&L attribution, and trade history. Available on the Pro plan."
    >
      <BookPageClient />
    </TierGate>
  );
}
