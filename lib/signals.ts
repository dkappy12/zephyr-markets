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

/** Normalised key for matching duplicate REMIT narratives (frontend-only dedupe). */
export function signalDedupeKey(
  row: Pick<SignalRow, "title" | "description">,
): string {
  const title = (row.title ?? "").trim();
  const desc = (row.description ?? "").trim();
  return `${title}\0${desc}`;
}

/**
 * Same physical outage can appear as multiple REMIT rows (different message IDs).
 * Keep one row per (title, description), preferring the latest created_at.
 * Returns rows sorted by created_at descending.
 */
export function dedupeSignalRowsByTitleDescription(
  rows: SignalRow[],
): SignalRow[] {
  const best = new Map<string, SignalRow>();
  for (const row of rows) {
    const k = signalDedupeKey(row);
    const cur = best.get(k);
    if (
      !cur ||
      new Date(row.created_at).getTime() >
        new Date(cur.created_at).getTime()
    ) {
      best.set(k, row);
    }
  }
  return Array.from(best.values()).sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
}

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
