export type ReliabilityConfidence = "high" | "medium" | "low";

export type ReliabilityEnvelope = {
  model_version: string;
  data_version: string;
  fallback_used: boolean;
  coverage: number;
  confidence: ReliabilityConfidence;
  evidence: string[];
  freshness_ts: string;
};

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

export function makeReliabilityEnvelope(input: {
  modelVersion: string;
  dataVersion: string;
  fallbackUsed: boolean;
  coverage: number;
  confidence?: ReliabilityConfidence;
  evidence?: string[];
  freshnessTs?: string;
}): ReliabilityEnvelope {
  const confidence =
    input.confidence ??
    (input.fallbackUsed || input.coverage < 0.5
      ? "low"
      : input.coverage < 0.8
        ? "medium"
        : "high");
  return {
    model_version: input.modelVersion,
    data_version: input.dataVersion,
    fallback_used: input.fallbackUsed,
    coverage: clamp01(input.coverage),
    confidence,
    evidence: input.evidence ?? [],
    freshness_ts: input.freshnessTs ?? new Date().toISOString(),
  };
}

/** Uppercase labels used on desk surfaces (Brief, Risk, Signal feed). */
export type DeskReliabilityLabel = "HIGH" | "MEDIUM" | "LOW";

export function formatReliabilityConfidenceDesk(
  c: ReliabilityConfidence,
): DeskReliabilityLabel {
  if (c === "high") return "HIGH";
  if (c === "medium") return "MEDIUM";
  return "LOW";
}

/** Morning brief: hours since `generated_at`. */
export function reliabilityConfidenceFromBriefAgeHours(
  ageHours: number | null,
): ReliabilityConfidence {
  if (ageHours == null) return "low";
  if (ageHours <= 24) return "high";
  if (ageHours <= 48) return "medium";
  return "low";
}

/** Risk VaR: days of overlapping daily P&L history (full confidence at 20+ days). */
export function reliabilityConfidenceFromVaRHistoryDays(
  days: number,
): ReliabilityConfidence {
  if (days >= 20) return "high";
  if (days >= 10) return "medium";
  return "low";
}

/** Signal feed: minutes since latest REMIT row. */
export function reliabilityConfidenceFromRemitStalenessMinutes(
  ageMinutes: number | null,
): ReliabilityConfidence {
  if (ageMinutes == null) return "low";
  if (ageMinutes <= 30) return "high";
  if (ageMinutes <= 120) return "medium";
  return "low";
}

/** True if `value` has every field required by the reliability contract. */
export function isReliabilityEnvelope(value: unknown): value is ReliabilityEnvelope {
  if (!value || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  return (
    typeof o.model_version === "string" &&
    typeof o.data_version === "string" &&
    typeof o.fallback_used === "boolean" &&
    typeof o.coverage === "number" &&
    (o.confidence === "high" ||
      o.confidence === "medium" ||
      o.confidence === "low") &&
    Array.isArray(o.evidence) &&
    o.evidence.every((e) => typeof e === "string") &&
    typeof o.freshness_ts === "string"
  );
}

