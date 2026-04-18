import { parseISO } from "date-fns";
import type { SignalRow } from "@/lib/signals";

export type AssetTab =
  | "ALL"
  | "CCGT"
  | "WIND"
  | "NUCLEAR"
  | "INTERCONNECTOR"
  | "STORAGE"
  | "OTHER";

const CCGT_TAGS = [
  "BLHLB", // Black Hill CCGT
  "BRGG", // Brigg CCGT
  "CDCL",
  "DRAXX",
  "FDUNT", // Ferrybridge CCGT
  "GRAI", // Grain CCGT
  "CNQPS",
  "PETEM", // Peterborough CCGT
  "PEHE",
  "ROCH", // Roch CCGT
  "SCCL", // Saltend CCGT
  "STAY", // Staythorpe (STAY-1, STAY-2, STAY-3, etc.)
  "TSREP", // Tees CCGT
  "WBUR", // West Burton B CCGT
  "CARR",
  "ROCK",
  "STAYS",
  "GANW",
  "HUMR",
  "SHBA",
  "DIDCB",
  "RATS",
  "KLYN",
  "SPLN",
  "MEDP",
  "PEMB",
  "SEAB",
  "SEAG",
  "IRON",
  "BOUT",
  "EGGPS",
  "DINO",
  "LNMTH",
  "MRWD",
  "FOYE",
  "TBGP",
  "KEADBY",
  "UNITA",
  "THUR",
  "NNGAO",
] as const;

const STORAGE_TAGS = ["LBAR", "BATT", "STOR"] as const;

const WIND_TAGS = [
  "WIND",
  "WF",
  "SOWE",
  "MORO",
  "DUDG",
  "LINW",
  "ORMONDE",
  "SCRO",
  "WIAL",
  "RRWF",
  "FIFO",
  "SGRWO",
  "BCRWO",
  "MOWEO",
  "MOWWO",
  "MORAY",
  "SOFWO",
  "SHERINGHAM",
] as const;

const NUCLEAR_TAGS = ["HEYM", "TORN", "WYLF", "SIZI", "HRTL"] as const;

const IC_TAGS = [
  "IFA",
  "BRITNED",
  "NSL",
  "NEMO",
  "ELEC",
  "EWIC",
  "MOYLE",
  "VIKING",
] as const;

/** Weights for impact sort (aligned with desk prioritisation). */
export const ASSET_TYPE_WEIGHT: Record<Exclude<AssetTab, "ALL">, number> = {
  CCGT: 1.0,
  WIND: 0.7,
  NUCLEAR: 1.3,
  INTERCONNECTOR: 1.2,
  STORAGE: 0.8,
  OTHER: 0.4,
};

const TITLE_SEPARATORS = [" — ", " – ", " - "] as const;

/** Part before title separator (em dash, en dash, or spaced hyphen) = asset name. */
export function assetNameFromTitle(title: string): string {
  const t = title.trim();
  for (const sep of TITLE_SEPARATORS) {
    const idx = t.indexOf(sep);
    if (idx !== -1) return t.slice(0, idx).trim() || t;
  }
  return t;
}

/** Text after the first recognised title separator (event label). */
export function eventLabelFromTitle(title: string): string {
  const t = title.trim();
  for (const sep of TITLE_SEPARATORS) {
    const idx = t.indexOf(sep);
    if (idx !== -1) return t.slice(idx + sep.length).trim();
  }
  return "";
}

function matchesAny(u: string, tags: readonly string[]): boolean {
  for (const tag of tags) {
    if (u.includes(tag)) return true;
  }
  return false;
}

/**
 * CCGT before STORAGE so assets matching both resolve to CCGT.
 * Order: WIND → NUCLEAR → INTERCONNECTOR → CCGT → STORAGE → OTHER.
 */
export function classifyAssetType(asset: string): Exclude<AssetTab, "ALL"> {
  const u = asset.toUpperCase();
  if (matchesAny(u, WIND_TAGS)) return "WIND";
  if (matchesAny(u, NUCLEAR_TAGS)) return "NUCLEAR";
  if (matchesAny(u, IC_TAGS)) return "INTERCONNECTOR";
  if (matchesAny(u, CCGT_TAGS)) return "CCGT";
  if (matchesAny(u, STORAGE_TAGS)) return "STORAGE";
  return "OTHER";
}

function parseNumLoose(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** MW unavailable from REMIT notice JSON when present. */
export function unavailableMwFromRaw(raw: unknown): number | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  return (
    parseNumLoose(o.unavailableCapacity) ??
    parseNumLoose(o.UnavailableCapacity)
  );
}

export function normalMwFromRaw(raw: unknown): number | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  return parseNumLoose(o.normalCapacity) ?? parseNumLoose(o.NormalCapacity);
}

function endTimeFromRaw(raw: unknown): Date | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const s = o.eventEndTime ?? o.EventEndTime;
  if (s == null || String(s).trim() === "") return null;
  try {
    let iso = String(s).trim();
    if (iso.endsWith("Z")) iso = iso.slice(0, -1) + "+00:00";
    const d = parseISO(iso);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

/** Parse "HH:MM UTC D Mon" from REMIT description (same as ingestion `format_event_time_utc`). */
export function parseRemitDisplayTimeUtc(display: string): Date | null {
  const y = new Date().getUTCFullYear();
  return parseUkRemitTime(display.trim(), y);
}

/** Prefer JSON end time; else parse `to …` / `until …` from description. */
export function outageEndUtcFromRow(row: SignalRow): Date | null {
  const rawEnd = endTimeFromRaw(row.raw_data);
  if (rawEnd) return rawEnd;
  const p = parseRemitDescription(row.description ?? "");
  if (!p.endDisplay) return null;
  return parseRemitDisplayTimeUtc(p.endDisplay);
}

/** Cleared: parsed end exists and is not after now. */
export function isOutageExpired(row: SignalRow, now: Date): boolean {
  const end = outageEndUtcFromRow(row);
  if (end == null) return false;
  return end.getTime() <= now.getTime();
}

/** Active = no end time, or end strictly in the future. */
export function isActiveOutage(row: SignalRow, now: Date): boolean {
  const end = outageEndUtcFromRow(row);
  if (end == null) return true;
  return end.getTime() > now.getTime();
}

export type ParsedDescription = {
  mwOffline: number | null;
  mwNormal: number | null;
  planned: boolean | null;
  unplanned: boolean | null;
  startDisplay: string | null;
  endDisplay: string | null;
  durationDisplay: string | null;
};

/**
 * Parses Python `build_description` output:
 * "{asset} derated by 515.0MW (645.0MW normal). Unplanned outage from … to …"
 */
export function parseRemitDescription(desc: string): ParsedDescription {
  const d = desc.trim();
  let mwOffline: number | null = null;
  let mwNormal: number | null = null;

  const der = d.match(
    /derated\s+by\s+([\d.]+)\s*MW/i,
  );
  if (der) mwOffline = parseNumLoose(der[1]);

  const norm = d.match(/\(\s*([\d.]+)\s*MW\s*normal\s*\)/i);
  if (norm) mwNormal = parseNumLoose(norm[1]);

  const unplanned = /\bUnplanned\b/i.test(d);
  const planned = /\bPlanned\b/i.test(d);

  let startDisplay: string | null = null;
  let endDisplay: string | null = null;

  const range = d.match(
    /from\s+(\d{1,2}:\d{2}\s+UTC\s+\d{1,2}\s+\w{3})\s+to\s+(\d{1,2}:\d{2}\s+UTC\s+\d{1,2}\s+\w{3})/i,
  );
  if (range) {
    startDisplay = range[1].replace(/\s+/g, " ").trim();
    endDisplay = range[2].replace(/\s+/g, " ").trim();
  } else {
    const fromOnly = d.match(
      /outage\s+from\s+(\d{1,2}:\d{2}\s+UTC\s+\d{1,2}\s+\w{3})\s*\./i,
    );
    if (fromOnly) startDisplay = fromOnly[1].replace(/\s+/g, " ").trim();
    const until = d.match(
      /outage\s+until\s+(\d{1,2}:\d{2}\s+UTC\s+\d{1,2}\s+\w{3})/i,
    );
    if (until) endDisplay = until[1].replace(/\s+/g, " ").trim();
  }

  let durationDisplay: string | null = null;
  if (startDisplay && endDisplay) {
    try {
      const y = new Date().getUTCFullYear();
      const s = parseUkRemitTime(startDisplay, y);
      const e = parseUkRemitTime(endDisplay, y);
      if (s && e && e > s) {
        const mins = Math.round((e.getTime() - s.getTime()) / 60000);
        if (mins >= 60) {
          const h = Math.floor(mins / 60);
          const m = mins % 60;
          durationDisplay =
            m > 0 ? `${h}h ${m}m` : `${h}h`;
        } else {
          durationDisplay = `${mins}m`;
        }
      }
    } catch {
      durationDisplay = null;
    }
  }

  return {
    mwOffline,
    mwNormal,
    planned: planned || null,
    unplanned: unplanned || null,
    startDisplay,
    endDisplay,
    durationDisplay,
  };
}

/** "06:22 UTC 16 Apr" → Date (UTC). */
function parseUkRemitTime(s: string, year: number): Date | null {
  const m = s.match(
    /^(\d{1,2}):(\d{2})\s+UTC\s+(\d{1,2})\s+(\w{3})$/i,
  );
  if (!m) return null;
  const months: Record<string, number> = {
    jan: 0,
    feb: 1,
    mar: 2,
    apr: 3,
    may: 4,
    jun: 5,
    jul: 6,
    aug: 7,
    sep: 8,
    oct: 9,
    nov: 10,
    dec: 11,
  };
  const mon = months[m[4].toLowerCase()];
  if (mon === undefined) return null;
  const day = Number(m[3]);
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  return new Date(Date.UTC(year, mon, day, hh, mm, 0, 0));
}

export function mwDeratedForRow(row: SignalRow): number | null {
  const fromRaw = unavailableMwFromRaw(row.raw_data);
  if (fromRaw != null) return fromRaw;
  const p = parseRemitDescription(row.description ?? "");
  return p.mwOffline;
}

export type Severity = "HIGH" | "MEDIUM" | "LOW";

export function severityForRow(
  row: SignalRow,
  mw: number | null,
): Severity {
  const desc = row.description ?? "";
  const planned = /\bPlanned\b/i.test(desc);
  const unplanned = /\bUnplanned\b/i.test(desc);
  const m = mw ?? 0;
  if (unplanned) {
    if (m >= 400) return "HIGH";
    if (m >= 100) return "MEDIUM";
    return "LOW";
  }
  if (planned) {
    if (m >= 800) return "HIGH";
    if (m >= 300) return "MEDIUM";
    return "LOW";
  }
  return "LOW";
}

/**
 * Impact for sort: MW × asset weight × (2.5 if description mentions unplanned).
 * e.g. DRAXX-4 515 MW unplanned CCGT → 515 × 1.0 × 2.5 = 1287.5
 */
export function impactScore(
  row: SignalRow,
  assetType: Exclude<AssetTab, "ALL">,
  mw: number | null,
): number {
  const parsedMw = mw ?? 0;
  const isUnplanned = (row.description ?? "").toLowerCase().includes("unplanned")
    ? 1
    : 0;
  const typeWeight = ASSET_TYPE_WEIGHT[assetType];
  const unplannedMultiplier = isUnplanned ? 2.5 : 1.0;
  return parsedMw * typeWeight * unplannedMultiplier;
}

export function estimatePriceImpactGbpMwh(
  mw: number | null,
  residualDemandGw: number | null,
): string | null {
  if (!mw || mw <= 0 || residualDemandGw == null) return null;
  const gw = mw / 1000;
  let slopePerGw: number;
  if (residualDemandGw < 20) slopePerGw = 2;
  else if (residualDemandGw < 28) slopePerGw = 5;
  else if (residualDemandGw < 32) slopePerGw = 15;
  else slopePerGw = 35;
  const impact = gw * slopePerGw;
  if (impact < 0.5) return null;
  return `~£${impact.toFixed(0)}/MWh estimated price impact`;
}

export function marketImplication(
  assetType: Exclude<AssetTab, "ALL">,
  mw: number | null,
  unplanned: boolean,
  planned: boolean,
  residualDemandGw: number | null = null,
): string {
  const m = Math.max(0, Math.round(mw ?? 0));
  let text: string;
  if (assetType === "CCGT" && planned) {
    text = `Planned maintenance — ${m} MW. Absorbed into day-ahead scheduling; expect minimal spot impact.`;
  } else if (assetType === "CCGT" && unplanned && m > 500) {
    text = `Significant thermal loss — ${m} MW removed from dispatch stack. Price supportive at current SRMC levels.`;
  } else if (assetType === "CCGT" && unplanned && m >= 200) {
    text = `Moderate thermal loss — ${m} MW offline. Marginal impact; wind output will determine if gas plant fills the gap.`;
  } else if (assetType === "CCGT" && unplanned) {
    text = `Minor thermal loss — ${m} MW offline. Likely absorbed with current system margin.`;
  } else if (assetType === "WIND" && unplanned) {
    text = `Wind constraint — ${m} MW offline. Reduces renewable oversupply pressure; slightly supportive for gas-marginal periods.`;
  } else if (assetType === "INTERCONNECTOR" && unplanned) {
    text = `Import capacity loss — ${m} MW. Reduces GB supply buffer; price impact depends on current import level.`;
  } else if (assetType === "NUCLEAR") {
    text = `Nuclear baseload reduction — ${m} MW. Increases residual demand by equivalent amount; gas or imports fill gap.`;
  } else if (assetType === "STORAGE") {
    text = `Storage derate — ${m} MW. May widen balancing and intraday spreads around peak periods.`;
  } else {
    text = "Monitor for system impact";
  }
  const impactHint = estimatePriceImpactGbpMwh(mw, residualDemandGw);
  return impactHint ? `${text} — ${impactHint}` : text;
}

export type CapacityHeaderStats = {
  unplannedMw: number;
  plannedMw: number;
  distinctAssets: number;
  topOutageLabel: string | null;
};

export function buildCapacityHeaderStats(
  rows: SignalRow[],
  now: Date,
): CapacityHeaderStats {
  let unplannedMw = 0;
  let plannedMw = 0;
  const assets = new Set<string>();
  let bestMw = -1;
  let bestLabel: string | null = null;

  for (const row of rows) {
    if (!isActiveOutage(row, now)) continue;
    const asset = assetNameFromTitle(row.title);
    assets.add(asset);

    const desc = row.description ?? "";
    const mw =
      unavailableMwFromRaw(row.raw_data) ??
      parseRemitDescription(desc).mwOffline ??
      0;
    if (!Number.isFinite(mw) || mw <= 0) continue;

    const isUn = /\bUnplanned\b/i.test(desc);
    const isPl = /\bPlanned\b/i.test(desc);
    if (isUn) unplannedMw += mw;
    else if (isPl) plannedMw += mw;

    if (mw > bestMw) {
      bestMw = mw;
      bestLabel = `${asset} · ${Math.round(mw).toLocaleString("en-GB")} MW`;
    }
  }

  if (bestMw < 0) bestLabel = null;

  return {
    unplannedMw,
    plannedMw,
    distinctAssets: assets.size,
    topOutageLabel: bestLabel,
  };
}

export type DedupedSignal = {
  latest: SignalRow;
  updateCount: number;
  asset: string;
};

/**
 * Group by asset name (before title separator); keep most recent row per asset + message count.
 */
export function dedupeByAsset(rows: SignalRow[]): DedupedSignal[] {
  const byAsset = new Map<string, SignalRow[]>();
  for (const row of rows) {
    const asset = assetNameFromTitle(row.title);
    const list = byAsset.get(asset) ?? [];
    list.push(row);
    byAsset.set(asset, list);
  }
  const out: DedupedSignal[] = [];
  for (const [asset, list] of byAsset) {
    const sorted = [...list].sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
    out.push({
      latest: sorted[0],
      updateCount: sorted.length,
      asset,
    });
  }
  return out;
}

/** @deprecated Use {@link dedupeByAsset} */
export const dedupeByAssetLast24h = dedupeByAsset;
