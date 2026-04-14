export type PositionDirection = "long" | "short";

export type PositionDraft = {
  user_id: string;
  instrument: string;
  instrument_type: string;
  market: string;
  direction: PositionDirection;
  size: number;
  unit: string;
  tenor: string | null;
  trade_price: number | null;
  currency: string | null;
  entry_date: string;
  expiry_date: string | null;
  notes: string | null;
  source: string;
  is_hypothetical: boolean;
  is_closed: boolean;
  raw_csv_row: string | null;
};

type PositionInput = {
  instrument?: unknown;
  instrument_type?: unknown;
  market?: unknown;
  direction?: unknown;
  size?: unknown;
  unit?: unknown;
  tenor?: unknown;
  trade_price?: unknown;
  currency?: unknown;
  entry_date?: unknown;
  expiry_date?: unknown;
  notes?: unknown;
  source?: unknown;
  is_hypothetical?: unknown;
  is_closed?: unknown;
  raw_csv_row?: unknown;
};

const ALLOWED_DIRECTIONS = new Set(["long", "short"]);
const ALLOWED_CURRENCIES = new Set(["GBP", "EUR", "USD"]);
const ALLOWED_UNITS = new Set(["mw", "mwh", "therm", "mmbtu", "tco2", "lot", "lots", "therms"]);

function asString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function asBoolean(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  return fallback;
}

function normaliseDate(value: unknown): string | null {
  const s = asString(value);
  if (!s) return null;
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!iso.test(s)) return null;
  return s;
}

function normaliseDirection(value: unknown): PositionDirection | null {
  const s = asString(value)?.toLowerCase();
  if (!s || !ALLOWED_DIRECTIONS.has(s)) return null;
  return s as PositionDirection;
}

function normaliseCurrency(value: unknown): string | null {
  const s = asString(value)?.toUpperCase();
  if (!s) return null;
  return ALLOWED_CURRENCIES.has(s) ? s : null;
}

function normaliseUnit(value: unknown): string | null {
  const s = asString(value)?.toLowerCase();
  if (!s) return null;
  if (!ALLOWED_UNITS.has(s)) return null;
  if (s === "therms") return "therm";
  if (s === "lots") return "lot";
  return s;
}

function validateMarketUnitCurrency(
  market: string,
  unit: string,
  currency: string | null,
): string | null {
  const m = market.toLowerCase();
  if (m === "nbp" && unit !== "therm") {
    return "NBP positions must use therm unit.";
  }
  if (m === "ttf" && currency !== "EUR") {
    return "TTF positions must use EUR currency.";
  }
  if (m === "eua" && currency !== "EUR") {
    return "EUA positions must use EUR currency.";
  }
  if (m === "uka" && currency !== "GBP") {
    return "UKA positions must use GBP currency.";
  }
  if ((m === "eua" || m === "uka") && unit !== "tco2") {
    return "Carbon positions must use tCO2 unit.";
  }
  return null;
}

function defaultEntryDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function makeDedupeKey(draft: PositionDraft): string {
  return [
    draft.instrument.toLowerCase(),
    draft.market.toLowerCase(),
    draft.direction,
    draft.size.toFixed(6),
    draft.unit.toLowerCase(),
    draft.tenor?.toLowerCase() ?? "",
    draft.entry_date,
    draft.trade_price != null ? draft.trade_price.toFixed(6) : "",
  ].join("|");
}

export function normalisePositionInput(
  userId: string,
  input: PositionInput,
): { ok: true; data: PositionDraft; dedupeKey: string } | { ok: false; error: string } {
  const instrument = asString(input.instrument);
  if (!instrument) return { ok: false, error: "Instrument is required." };

  const instrumentType = asString(input.instrument_type);
  if (!instrumentType) return { ok: false, error: "Instrument type is required." };

  const market = asString(input.market);
  if (!market) return { ok: false, error: "Market is required." };

  const direction = normaliseDirection(input.direction);
  if (!direction) return { ok: false, error: "Direction must be long or short." };

  const size = asNumber(input.size);
  if (size == null || size === 0) {
    return { ok: false, error: "Size must be a non-zero number." };
  }

  const unit = normaliseUnit(input.unit);
  if (!unit) return { ok: false, error: "Unit is invalid." };

  const tenor = asString(input.tenor);
  const tradePrice = asNumber(input.trade_price);
  const currency = normaliseCurrency(input.currency);
  const compatibilityError = validateMarketUnitCurrency(market, unit, currency);
  if (compatibilityError) {
    return { ok: false, error: compatibilityError };
  }
  const entryDate = normaliseDate(input.entry_date) ?? defaultEntryDate();
  const expiryDate = normaliseDate(input.expiry_date);
  const notes = asString(input.notes);
  const source = asString(input.source) ?? "manual";
  const isHypothetical = asBoolean(input.is_hypothetical, false);
  const isClosed = asBoolean(input.is_closed, false);
  const rawCsvRow =
    typeof input.raw_csv_row === "string" ? input.raw_csv_row : null;

  const data: PositionDraft = {
    user_id: userId,
    instrument,
    instrument_type: instrumentType,
    market,
    direction,
    size,
    unit,
    tenor,
    trade_price: tradePrice,
    currency,
    entry_date: entryDate,
    expiry_date: expiryDate,
    notes,
    source,
    is_hypothetical: isHypothetical,
    is_closed: isClosed,
    raw_csv_row: rawCsvRow,
  };

  return { ok: true, data, dedupeKey: makeDedupeKey(data) };
}
