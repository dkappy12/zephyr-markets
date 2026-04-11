import { parseISO } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import type { SignalCardProps } from "@/components/ui/SignalCard";

/** Row shape from `signals` table (PostgREST / Supabase). */
export type SignalRow = {
  id: string;
  type: string | null;
  title: string;
  description: string | null;
  direction: string | null;
  source: string | null;
  confidence: string | null;
  created_at: string;
  raw_data: unknown;
};

/** Format `created_at` as UTC "HH:mm GMT" using date-fns + date-fns-tz. */
export function formatSignalTimestamp(iso: string): string {
  const d = parseISO(iso);
  return `${formatInTimeZone(d, "UTC", "HH:mm")} GMT`;
}

function normalizeTone(direction: string | null): SignalCardProps["tone"] {
  const v = (direction || "").toLowerCase();
  if (v === "bull" || v === "bear" || v === "watch" || v === "neutral") return v;
  return "neutral";
}

function mapDbTypeToCardType(
  dbType: string | null,
): NonNullable<SignalCardProps["type"]> {
  if (!dbType) return "generic";
  const t = dbType.toLowerCase();
  if (t === "remit") return "remit";
  if (t === "flow") return "flow";
  if (t === "weather") return "weather";
  if (t === "lng") return "lng";
  if (t === "alert") return "alert";
  return "generic";
}

export function signalRowToCardProps(
  row: SignalRow,
): SignalCardProps & { id: string } {
  return {
    id: row.id,
    tone: normalizeTone(row.direction),
    type: mapDbTypeToCardType(row.type),
    title: row.title,
    description: row.description ?? "",
    source: row.source ?? undefined,
    timestamp: formatSignalTimestamp(row.created_at),
    confidence: row.confidence ?? undefined,
  };
}
